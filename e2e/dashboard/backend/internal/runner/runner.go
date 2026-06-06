package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

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

	creds := map[string]string{}
	if len(credsJSON) > 0 {
		_ = json.Unmarshal(credsJSON, &creds)
	}

	// Fetch run record for environment info
	run, err := s.runQ.GetByID(ctx, runID)
	if err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("get run: %v", err))
		return
	}

	// Resolve base URL + credentials from the environment, with per-run
	// credentials taking precedence over the environment's defaults.
	baseURL := ""
	if run.EnvironmentID != nil {
		baseURL, _ = s.getEnvBaseURL(ctx, *run.EnvironmentID)
		envUser, envPass := s.getEnvCredentials(ctx, *run.EnvironmentID)
		if creds["email"] == "" {
			creds["email"] = envUser
		}
		if creds["password"] == "" {
			creds["password"] = envPass
		}
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

	// The generated config imports `@playwright/test`. The workspace is in /tmp
	// with no node_modules, so Node can't resolve that import. Symlink the host
	// scout repo's node_modules into the workspace so module resolution works.
	playwrightProjectDir := os.Getenv("SCOUT_PLAYWRIGHT_PROJECT_DIR")
	if playwrightProjectDir == "" {
		cwd, _ := os.Getwd()
		playwrightProjectDir = FindPlaywrightProjectDir(cwd)
	}
	if playwrightProjectDir == "" {
		s.failRun(ctx, runID, orgID,
			"could not locate node_modules/@playwright/test — set SCOUT_PLAYWRIGHT_PROJECT_DIR to the repo root that has Playwright installed")
		return
	}
	if err := ws.LinkNodeModules(filepath.Join(playwrightProjectDir, "node_modules")); err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("link node_modules: %v", err))
		return
	}

	// Build the playwright command
	cmd := exec.CommandContext(ctx, "npx", "playwright", "test",
		"--config", filepath.Join(ws.Dir, "playwright.config.ts"),
	)
	cmd.Dir = playwrightProjectDir

	// Inject env vars at OS process level — never written to any file on disk.
	// Note: credentials remain in cmd.Env (and therefore in process memory) for
	// the lifetime of the child process; we rely on process isolation, not
	// in-memory zeroization, to protect them.
	hostNodeModules := filepath.Join(playwrightProjectDir, "node_modules")
	cmd.Env = append(os.Environ(),
		"TESTDECK_BASE_URL="+baseURL,
		"TESTDECK_EMAIL="+creds["email"],
		"TESTDECK_PASSWORD="+creds["password"],
		"NODE_PATH="+hostNodeModules,
	)

	// Keep diagnostic context for failure messages: a ring of the last 60 lines
	// plus any line that looks like a top-of-error summary (e.g. "Error: Cannot
	// find module ..."), since those carry the action-relevant info but tend to
	// sit far above the rest of the stack.
	const tailCap = 60
	var tailMu sync.Mutex
	tail := make([]string, 0, tailCap)
	errLines := make([]string, 0, 8)
	keepErr := func(line string) {
		l := strings.ToLower(line)
		switch {
		case strings.HasPrefix(line, "Error:"),
			strings.Contains(l, "cannot find module"),
			strings.Contains(l, "module_not_found"),
			strings.Contains(l, "executable doesn't exist"):
			errLines = append(errLines, line)
		}
	}
	appendTail := func(s string) {
		tailMu.Lock()
		defer tailMu.Unlock()
		keepErr(s)
		if len(tail) == tailCap {
			tail = append(tail[:0], tail[1:]...)
		}
		tail = append(tail, s)
	}

	runErr := startAndStream(cmd, func(line string) {
		s.streams.Publish(ctx, runID, "stdout", line)
		appendTail(line)
	})

	// Parse results even if playwright exited non-zero (failed tests)
	result, parseErr := ParseResults(ws.ResultsPath())
	if parseErr != nil {
		log.Printf("[runner] parse results error for run %s: %v", runID, parseErr)
		if runErr != nil {
			tailMu.Lock()
			tailCopy := strings.Join(tail, "\n")
			errCopy := strings.Join(errLines, "\n")
			tailMu.Unlock()
			msg := fmt.Sprintf("playwright exited (%v); results.json could not be read (%v).", runErr, parseErr)
			if errCopy != "" {
				msg += "\n\nDiagnostic:\n" + errCopy
			}
			if tailCopy != "" {
				msg += "\n\nLast output:\n" + tailCopy
			}
			s.failRun(ctx, runID, orgID, msg)
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

// splitOnCRorLF is a bufio.SplitFunc that yields a token whenever it sees
// either \n or \r, so a reporter that "redraws" with \r still produces
// frames we can stream to the dashboard.
func splitOnCRorLF(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func (s *Service) failRun(ctx context.Context, runID, orgID uuid.UUID, reason string) {
	log.Printf("[runner] run %s failed: %s", runID, reason)
	s.streams.Publish(ctx, runID, "error", reason)
	s.streams.Publish(ctx, runID, "status", "failed")
	_ = s.runQ.SetErrorMessage(ctx, runID, reason)
	_ = s.runQ.UpdateStatus(ctx, runID, "failed")
	s.notifyCompletion(ctx, runID, orgID, "failed", nil)
}

// getEnvBaseURL resolves the base URL for a run. Precedence:
//
//  1. subproject_env_urls.base_url (per-subproject override)
//  2. environments.base_url        (environment-level default)
//
// Either may be empty; the caller decides whether that's fatal.
func (s *Service) getEnvBaseURL(ctx context.Context, envID uuid.UUID) (string, error) {
	var override, envBase string
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE((
		   SELECT base_url FROM subproject_env_urls WHERE environment_id = $1 LIMIT 1
		 ), ''),
		 COALESCE(e.base_url, '')
		 FROM environments e WHERE e.id = $1`, envID,
	).Scan(&override, &envBase)
	if err != nil {
		return "", err
	}
	if override != "" {
		return override, nil
	}
	return envBase, nil
}

// getEnvCredentials returns the environment-level username/password used as a
// fallback when a run doesn't carry its own credentials_json.
func (s *Service) getEnvCredentials(ctx context.Context, envID uuid.UUID) (username, password string) {
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(username, ''), COALESCE(password, '')
		 FROM environments WHERE id = $1`, envID,
	).Scan(&username, &password)
	return username, password
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
