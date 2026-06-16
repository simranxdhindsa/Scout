package runner

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/notifications"
	"github.com/apyhub/scout/internal/slack"
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
	// The queue is in-memory only. A prior server restart/crash leaves any
	// mid-flight runs stuck in 'queued'/'running' with no worker to finish
	// them — they'd show "running" forever. Reconcile them to 'failed' first.
	if n, err := s.runQ.ReconcileStuckRuns(ctx); err != nil {
		log.Printf("[runner] reconcile stuck runs: %v", err)
	} else if n > 0 {
		log.Printf("[runner] reconciled %d stuck run(s) left over from a previous restart", n)
	}

	s.queue.StartWorkers(ctx, func(ctx context.Context, job *RunJob) {
		if job.IsFlow {
			s.processFlowRun(ctx, job)
		} else {
			s.processRun(ctx, job)
		}
	})
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

	// Resolve Playwright project dir early so the workspace lives inside it.
	// This lets Node find @playwright/test naturally by walking up to node_modules,
	// avoiding junction/NODE_PATH resolution issues on Windows.
	playwrightProjectDir := os.Getenv("SCOUT_PLAYWRIGHT_PROJECT_DIR")
	if playwrightProjectDir == "" {
		cwd, _ := os.Getwd()
		playwrightProjectDir = FindPlaywrightProjectDir(cwd)
	}

	// Create temp workspace inside the playwright project dir (or os.TempDir as fallback)
	ws, err := NewWorkspace(runID, playwrightProjectDir)
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
	cfgOpts.Headed = job.Headed

	// If credentials are available, generate a login setup so every spec runs
	// authenticated (mirrors the ardoise-tests global-setup.ts). Without this,
	// specs that assume a logged-in session land on /auth/signIn and fail —
	// only self-contained specs pass. No credentials → run unauthenticated.
	if creds["email"] != "" && creds["password"] != "" {
		authStatePath := ws.AuthStatePath()
		setupPath, err := ws.WriteAuthSetup(GenerateAuthSetup(authStatePath))
		if err != nil {
			s.streams.Publish(ctx, runID, "stderr", fmt.Sprintf("warn: could not write auth setup, running unauthenticated: %v", err))
		} else {
			cfgOpts.AuthSetupFile = setupPath
			cfgOpts.AuthStatePath = authStatePath
		}
	}

	cfgContent := GenerateConfig(cfgOpts)

	if _, err := ws.WriteConfig(cfgContent); err != nil {
		s.failRun(ctx, runID, orgID, fmt.Sprintf("write playwright config: %v", err))
		return
	}

	// Verify the playwright project dir was found (resolved earlier for workspace placement).
	if playwrightProjectDir == "" {
		s.failRun(ctx, runID, orgID,
			"could not locate node_modules/@playwright/test — set SCOUT_PLAYWRIGHT_PROJECT_DIR to the repo root that has Playwright installed")
		return
	}
	// Build the playwright command
	pwArgs := []string{"playwright", "test",
		"--config", filepath.Join(ws.Dir, "playwright.config.ts"),
	}
	if job.Headed {
		pwArgs = append(pwArgs, "--headed")
	}
	cmd := exec.CommandContext(ctx, "npx", pwArgs...)
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

	// Live screenshot watcher — polls test-results/ for new PNGs every 500 ms
	// and streams each one as a base64 data URL via the WebSocket hub.
	watchCtx, cancelWatch := context.WithCancel(ctx)
	go func() {
		seen := make(map[string]struct{})
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-watchCtx.Done():
				return
			case <-ticker.C:
				for _, f := range ws.ListFiles(ws.TestResultsDir(), ".png") {
					if _, ok := seen[f]; ok {
						continue
					}
					seen[f] = struct{}{}
					data, err := os.ReadFile(f)
					if err != nil || len(data) > 1<<20 { // skip files > 1 MB
						continue
					}
					s.streams.Publish(ctx, runID, "screenshot",
						"data:image/png;base64,"+base64.StdEncoding.EncodeToString(data))
				}
			}
		}
	}()

	runErr := startAndStream(cmd, func(line string) {
		s.streams.Publish(ctx, runID, "stdout", line)
		appendTail(line)
	})
	cancelWatch() // stop screenshot watcher once the process exits

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

		// Update spec-level run items and persist each individual test() result
		// so the run detail page can show a per-test pass/fail breakdown.
		for _, tr := range result.TestResults {
			itemID := s.updateRunItemByName(ctx, runID, tr)
			if err := s.runQ.SaveTestResult(ctx, runID, itemID,
				tr.FileName, tr.Title, tr.Status, tr.DurationMs,
				tr.ErrorMessage, tr.ErrorStack, tr.RetryCount,
			); err != nil {
				log.Printf("[runner] save test result error: %v", err)
			}
		}

		// Upload test-result attachments (screenshots from individual test cases)
		s.uploadAttachments(ctx, runID, orgID, result.TestResults)
	}

	// Upload video and trace files produced by Playwright into run_attachments.
	// This runs regardless of pass/fail so videos/traces are always preserved.
	s.uploadRunMediaFiles(ctx, runID, orgID, ws)

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
	if err := s.runQ.FailItems(ctx, runID); err != nil {
		log.Printf("[runner] failItems run=%s: %v", runID, err)
	}
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

// fileNamesMatch returns true if a and b refer to the same file ignoring
// extensions — handles the common case where a test case is stored as
// "dashboard.spec" but the Playwright report uses "dashboard.spec.ts".
func fileNamesMatch(a, b string) bool {
	stripExt := func(s string) string {
		for {
			ext := filepath.Ext(s)
			if ext == "" {
				return s
			}
			s = strings.TrimSuffix(s, ext)
		}
	}
	return a == b || stripExt(filepath.Base(a)) == stripExt(filepath.Base(b))
}

// updateRunItemByName matches a parsed test result to its spec-level run item
// (by file name / title heuristic) and updates it. Returns the matched run_item
// id, or nil when no item matched.
func (s *Service) updateRunItemByName(ctx context.Context, runID uuid.UUID, tr ParsedTestResult) *uuid.UUID {
	// Match run item by test case file name heuristic
	items, err := s.runQ.ListItems(ctx, runID)
	if err != nil {
		return nil
	}
	for _, item := range items {
		if item.TestCaseID == nil {
			continue
		}
		tc, err := s.testQ.GetByID(ctx, *item.TestCaseID)
		if err != nil {
			continue
		}
		if fileNamesMatch(tc.FileName, tr.FileName) || tc.Name == tr.Title {
			_ = s.runQ.UpdateItem(ctx, item.ID, tr.Status, tr.DurationMs, tr.ErrorMessage, tr.ErrorStack)
			id := item.ID
			return &id
		}
	}
	return nil
}

func (s *Service) uploadAttachments(ctx context.Context, runID, orgID uuid.UUID, results []ParsedTestResult) {
	items, err := s.runQ.ListItems(ctx, runID)
	if err != nil || len(items) == 0 {
		return
	}

	// Match a parsed test result to its owning run item by the same file
	// name / title heuristic used in updateRunItemByName; fall back to the
	// first item so attachments are never orphaned.
	itemFor := func(tr ParsedTestResult) uuid.UUID {
		for _, item := range items {
			if item.TestCaseID == nil {
				continue
			}
			tc, err := s.testQ.GetByID(ctx, *item.TestCaseID)
			if err != nil {
				continue
			}
			if tc.FileName == tr.FileName || tc.Name == tr.Title {
				return item.ID
			}
		}
		return items[0].ID
	}

	for _, tr := range results {
		itemID := itemFor(tr)
		for _, att := range tr.Attachments {
			if att.Path == "" {
				continue
			}
			f, err := os.Open(att.Path)
			if err != nil {
				continue
			}
			key := storage.RunAttachmentKey(orgID.String(), runID.String(), uniqueAttachmentName(att.Path))
			url, err := s.store.Put(ctx, key, f, "application/octet-stream")
			f.Close()
			if err != nil {
				continue
			}
			_ = s.runQ.SaveAttachment(ctx, itemID, att.Type, url, tr.Title)
		}
	}
}

// uniqueAttachmentName builds a collision-free storage filename for a Playwright
// artifact. Playwright names auto artifacts identically across tests
// ("test-finished-1.png", "video.webm", "trace.zip") inside a per-test
// subdirectory, so the base name alone collides and uploads overwrite each
// other. Prefixing with the enclosing directory name keeps each test's
// artifact distinct.
func uniqueAttachmentName(path string) string {
	base := filepath.Base(path)
	parent := filepath.Base(filepath.Dir(path))
	switch parent {
	case "", ".", string(filepath.Separator), "test-results":
		return base
	}
	return parent + "-" + base
}

// uploadRunMediaFiles scans the workspace test-results dir for videos (.webm)
// and traces (.zip), uploads each to storage, and records them in
// run_attachments. Both are uploaded regardless of test outcome so they are
// always available from the run detail page. Screenshots are intentionally not
// handled here — they're uploaded per-test in uploadAttachments from the parsed
// report, which gives an accurate test→screenshot mapping; scanning for .png
// here too would double-upload them.
func (s *Service) uploadRunMediaFiles(ctx context.Context, runID, orgID uuid.UUID, ws *Workspace) {
	items, err := s.runQ.ListItems(ctx, runID)
	if err != nil || len(items) == 0 {
		return
	}
	// Best-effort match: try to find a run item whose test name appears in the
	// file path. Fall back to the first item so attachments are never orphaned.
	itemFor := func(path string) uuid.UUID {
		base := strings.ToLower(filepath.Base(filepath.Dir(path)))
		for _, it := range items {
			if it.TestCaseName != "" &&
				strings.Contains(base, strings.ToLower(strings.ReplaceAll(it.TestCaseName, " ", "-"))) {
				return it.ID
			}
		}
		return items[0].ID
	}

	type upload struct {
		ext         string
		contentType string
		attachType  string
	}
	for _, u := range []upload{
		{".webm", "video/webm", "video"},
		{".zip", "application/zip", "trace"},
	} {
		for _, f := range ws.ListFiles(ws.TestResultsDir(), u.ext) {
			fh, err := os.Open(f)
			if err != nil {
				continue
			}
			key := storage.RunAttachmentKey(orgID.String(), runID.String(), uniqueAttachmentName(f))
			url, err := s.store.Put(ctx, key, fh, u.contentType)
			fh.Close()
			if err != nil {
				log.Printf("[runner] upload media %s: %v", filepath.Base(f), err)
				continue
			}
			_ = s.runQ.SaveAttachment(ctx, itemFor(f), u.attachType, url, "")
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

	passed, failed, total := 0, 0, 0
	if result != nil {
		passed = result.Passed
		failed = result.Failed
		total = result.Total
		msg = fmt.Sprintf("Passed: %d / %d · Duration: %dms", result.Passed, result.Total, result.DurationMs)
	}

	_ = s.notif.NotifyOrg(ctx, orgID, &runID, notifType, title, msg, nil)

	// Slack webhook notification
	s.sendSlackNotification(ctx, orgID, runID, status, passed, failed, total)
}

func (s *Service) sendSlackNotification(ctx context.Context, orgID, runID uuid.UUID, status string, passed, failed, total int) {
	var webhookURL string
	var notifyOnFailure, notifyOnSuccess bool
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(slack_webhook_url,''),
		        COALESCE(slack_notify_on_failure, TRUE),
		        COALESCE(slack_notify_on_success, FALSE)
		 FROM organizations WHERE id = $1`, orgID,
	).Scan(&webhookURL, &notifyOnFailure, &notifyOnSuccess)
	if err != nil || webhookURL == "" {
		return
	}
	if status == "failed" && !notifyOnFailure {
		return
	}
	if status != "failed" && !notifyOnSuccess {
		return
	}

	run, _ := s.runQ.GetByID(ctx, runID)
	label := "Run"
	if run != nil {
		label = run.Label
	}

	dashURL := os.Getenv("SCOUT_DASHBOARD_URL")
	if err := slack.Notify(ctx, webhookURL, slack.RunSummary{
		Label:   label,
		Status:  status,
		Passed:  passed,
		Failed:  failed,
		Total:   total,
		RunID:   runID.String(),
		DashURL: dashURL,
	}); err != nil {
		log.Printf("[runner] slack notify: %v", err)
	}
}
