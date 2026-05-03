package runner

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/notifications"
	"github.com/apyhub/scout/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AIIndexer is a minimal interface so runner can trigger RAG indexing post-run
// without importing the full ai package (avoids circular deps).
type AIIndexer interface {
	IndexRunErrors(ctx context.Context, orgID, runID uuid.UUID) error
}

// Service is the top-level runner service wired in main.go.
type Service struct {
	db        *pgxpool.Pool
	store     storage.Storage
	notif     *notifications.Service
	ai        AIIndexer
	queue     *RunQueue
	streams   *StreamManager
	bundler   *Bundler
	runQ      *queries.RunQueries
	testQ     *queries.TestQueries
	folderQ   *queries.FolderQueries
	orgQ      *queries.OrgQueries
}

// NewService constructs a runner.Service with all dependencies.
func NewService(db *pgxpool.Pool, store storage.Storage, notif *notifications.Service, ai AIIndexer, maxConcurrent int) *Service {
	return &Service{
		db:      db,
		store:   store,
		notif:   notif,
		ai:      ai,
		queue:   NewRunQueue(maxConcurrent),
		streams: NewStreamManager(),
		bundler: NewBundler(),
		runQ:    queries.NewRunQueries(db),
		testQ:   queries.NewTestQueries(db),
		folderQ: queries.NewFolderQueries(db),
		orgQ:    queries.NewOrgQueries(db),
	}
}

// Bundler exposes the esbuild bundler for API-layer use.
func (s *Service) Bundler() *Bundler { return s.bundler }

// StartWorkers launches the background run-processing goroutines.
func (s *Service) StartWorkers(ctx context.Context) {
	s.queue.StartWorkers(ctx, s.processRun)
}

// Enqueue adds a run to the processing queue.
func (s *Service) Enqueue(job *RunJob) {
	s.queue.Enqueue(job)
}

// Stop cancels an active run.
func (s *Service) Stop(runID uuid.UUID) bool {
	return s.queue.Stop(runID)
}

// ActiveCount returns how many runs are currently executing.
func (s *Service) ActiveCount() int {
	return s.queue.ActiveCount()
}

// StreamManager exposes the stream manager for the API handler.
func (s *Service) Streams() *StreamManager {
	return s.streams
}

// ── Core execution ────────────────────────────────────────────────────────────

// processRun is the full end-to-end execution flow for a single run.
// Called by the queue worker goroutine.
func (s *Service) processRun(ctx context.Context, job *RunJob) {
	runID := job.RunID
	orgID := job.OrgID

	log.Printf("[runner] processing run %s", runID)

	// Create WebSocket stream hub
	s.streams.CreateHub(runID)
	defer s.streams.RemoveHub(runID)

	// Mark run as running
	if err := s.runQ.UpdateStatus(ctx, runID, "running"); err != nil {
		log.Printf("[runner] failed to mark run %s running: %v", runID, err)
		return
	}
	s.streams.Publish(ctx, runID, "status", "running")

	// Read + immediately clear credentials from DB
	credsJSON, err := s.runQ.GetCredentials(ctx, runID)
	if err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("read credentials: %v", err))
		return
	}

	var creds map[string]string
	if len(credsJSON) > 0 {
		_ = json.Unmarshal(credsJSON, &creds)
	}

	// Fetch run record for environment info
	run, err := s.runQ.GetByID(ctx, runID)
	if err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("get run: %v", err))
		return
	}

	// Resolve base URL from environment
	baseURL := ""
	if run.EnvironmentID != nil {
		baseURL, _ = s.getEnvBaseURL(ctx, *run.EnvironmentID)
	}

	// Fetch all run items to know which tests to execute
	items, err := s.runQ.ListItems(ctx, runID)
	if err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("list run items: %v", err))
		return
	}

	// Create temp workspace
	ws, err := NewWorkspace(runID)
	if err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("create workspace: %v", err))
		return
	}
	defer ws.Cleanup(ctx)

	// Write each test file to workspace
	var testFilePaths []string
	for _, item := range items {
		if item.TestCaseID == nil {
			continue
		}
		tc, err := s.testQ.GetByID(ctx, *item.TestCaseID)
		if err != nil {
			s.streams.Publish(ctx, runID, "stderr", fmt.Sprintf("warn: could not load test %s: %v", item.TestCaseID, err))
			continue
		}

		content := tc.BundledContent
		if content == "" {
			content = tc.FileContent
		}

		path, err := ws.WriteTestFile(tc.FileName, content)
		if err != nil {
			s.streams.Publish(ctx, runID, "stderr", fmt.Sprintf("warn: could not write test file: %v", err))
			continue
		}
		testFilePaths = append(testFilePaths, path)
	}

	if len(testFilePaths) == 0 {
		s.failRun(ctx, runID, orgID, "no test files could be written to workspace")
		return
	}

	// Generate playwright config
	cfgOpts := DefaultConfigOptions(ws.Dir)
	cfgOpts.TestFiles = testFilePaths
	cfgContent := GenerateConfig(cfgOpts)

	if _, err := ws.WriteConfig(cfgContent); err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("write playwright config: %v", err))
		return
	}

	// Build the playwright command
	cmd := exec.CommandContext(ctx, "npx", "playwright", "test",
		"--config", filepath.Join(ws.Dir, "playwright.config.ts"),
	)

	// Inject env vars at OS process level — NEVER written to any file
	cmd.Env = append(os.Environ(),
		"TESTDECK_BASE_URL="+baseURL,
		"TESTDECK_EMAIL="+creds["email"],
		"TESTDECK_PASSWORD="+creds["password"],
	)
	// Clear creds from memory
	creds = nil

	// Stream stdout + stderr via WebSocket
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("start playwright: %v", err))
		return
	}

	// Stream stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			s.streams.Publish(ctx, runID, "stdout", scanner.Text())
		}
	}()

	// Stream stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			s.streams.Publish(ctx, runID, "stderr", scanner.Text())
		}
	}()

	// Wait for playwright to finish
	runErr := cmd.Wait()

	// Parse results even if playwright exited non-zero (failed tests)
	result, parseErr := ParseResults(ws.ResultsPath())
	if parseErr != nil {
		log.Printf("[runner] parse results error for run %s: %v", runID, parseErr)
		if runErr != nil {
			s.failRun(ctx, runID, orgID, fmt.Sprintf("playwright failed and results unparseable: %v", runErr))
			return
		}
	}

	// Save report to DB
	if result != nil {
		reportURL := ""
		if err := s.runQ.SaveReport(ctx, runID,
			result.Passed, result.Failed, result.Skipped, result.TimedOut,
			result.Total, result.DurationMs, reportURL,
			result.ConsoleErrors, result.APIErrors, result.FailedRequests, result.PageErrors,
		); err != nil {
			log.Printf("[runner] save report error: %v", err)
		}

		// Update individual run items
		for _, tr := range result.TestResults {
			s.updateRunItemByName(ctx, runID, tr)
		}

		// Upload attachments
		s.uploadAttachments(ctx, runID, orgID, result.TestResults)
	}

	// Determine final status
	finalStatus := "done"
	if result != nil && result.Failed > 0 {
		finalStatus = "failed"
	}
	if runErr != nil && result == nil {
		finalStatus = "failed"
	}

	if err := s.runQ.UpdateStatus(ctx, runID, finalStatus); err != nil {
		log.Printf("[runner] update final status error: %v", err)
	}

	s.streams.Publish(ctx, runID, "status", finalStatus)
	s.streams.Publish(ctx, runID, "done", "")

	// Notify org members
	s.notifyCompletion(ctx, runID, orgID, finalStatus, result)

	// Index errors into RAG store
	if s.ai != nil {
		go func() {
			if err := s.ai.IndexRunErrors(context.Background(), orgID, runID); err != nil {
				log.Printf("[runner] rag index error: %v", err)
			}
		}()
	}

	log.Printf("[runner] run %s completed with status %s", runID, finalStatus)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func (s *Service) failRun(ctx context.Context, runID, orgID uuid.UUID, reason string) {
	log.Printf("[runner] run %s failed: %s", runID, reason)
	s.streams.Publish(ctx, runID, "error", reason)
	s.streams.Publish(ctx, runID, "status", "failed")
	_ = s.runQ.UpdateStatus(ctx, runID, "failed")
	s.notifyCompletion(ctx, runID, orgID, "failed", nil)
}

func (s *Service) getEnvBaseURL(ctx context.Context, envID uuid.UUID) (string, error) {
	var baseURL string
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(seu.base_url, '') FROM environments e
		 LEFT JOIN subproject_env_urls seu ON seu.environment_id = e.id
		 WHERE e.id = $1 LIMIT 1`, envID,
	).Scan(&baseURL)
	return baseURL, err
}

func (s *Service) updateRunItemByName(ctx context.Context, runID uuid.UUID, tr ParsedTestResult) {
	// Match run item by test case file name heuristic
	items, err := s.runQ.ListItems(ctx, runID)
	if err != nil {
		return
	}
	for _, item := range items {
		if item.TestCaseID == nil {
			continue
		}
		tc, err := s.testQ.GetByID(ctx, *item.TestCaseID)
		if err != nil {
			continue
		}
		if tc.FileName == tr.FileName || tc.Name == tr.Title {
			_ = s.runQ.UpdateItem(ctx, item.ID, tr.Status, tr.DurationMs, tr.ErrorMessage, tr.ErrorStack)
			return
		}
	}
}

func (s *Service) uploadAttachments(ctx context.Context, runID, orgID uuid.UUID, results []ParsedTestResult) {
	items, err := s.runQ.ListItems(ctx, runID)
	if err != nil {
		return
	}

	for _, tr := range results {
		for _, item := range items {
			if item.TestCaseID == nil {
				continue
			}
			for _, att := range tr.Attachments {
				if att.Path == "" {
					continue
				}
				f, err := os.Open(att.Path)
				if err != nil {
					continue
				}
				key := storage.RunAttachmentKey(orgID.String(), runID.String(), filepath.Base(att.Path))
				url, err := s.store.Put(ctx, key, f, "application/octet-stream")
				f.Close()
				if err != nil {
					continue
				}
				_ = s.runQ.SaveAttachment(ctx, item.ID, att.Type, url)
			}
		}
	}
}

func (s *Service) notifyCompletion(ctx context.Context, runID, orgID uuid.UUID, status string, result *ParsedResult) {
	title := "Run completed"
	msg := ""
	notifType := "run_complete"

	if status == "failed" {
		title = "Run failed"
		notifType = "run_failed"
	}

	if result != nil {
		msg = fmt.Sprintf("Passed: %d / %d · Duration: %dms", result.Passed, result.Total, result.DurationMs)
	}

	_ = s.notif.NotifyOrg(ctx, orgID, &runID, notifType, title, msg, nil)
}
