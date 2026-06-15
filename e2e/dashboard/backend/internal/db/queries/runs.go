package queries

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type TestRun struct {
	ID              uuid.UUID  `json:"id"`
	OrgID           uuid.UUID  `json:"org_id"`
	PipelineID      *uuid.UUID `json:"pipeline_id"`
	EnvironmentID   *uuid.UUID `json:"environment_id"`
	TriggeredBy     *uuid.UUID `json:"triggered_by"`
	Status          string     `json:"status"`
	Label           string     `json:"label"`
	ErrorMessage    string     `json:"error_message,omitempty"`
	StartedAt       *time.Time `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at"`
	CreatedAt       time.Time  `json:"created_at"`
	EnvironmentName string     `json:"environment_name,omitempty"`
}

type RunItem struct {
	ID           uuid.UUID  `json:"id"`
	RunID        uuid.UUID  `json:"run_id"`
	TestCaseID   *uuid.UUID `json:"test_case_id"`
	PipelineStep *int       `json:"pipeline_step"`
	Status       string     `json:"status"`
	DurationMs   *int       `json:"duration_ms"`
	ErrorMessage string     `json:"error_message,omitempty"`
	ErrorStack   string     `json:"error_stack,omitempty"`
	RetryCount   int        `json:"retry_count"`
	StartedAt    *time.Time `json:"started_at"`
	CompletedAt  *time.Time `json:"completed_at"`
	// Joined
	TestCaseName string `json:"test_case_name,omitempty"`
}

type RunTestResult struct {
	ID           uuid.UUID  `json:"id"`
	RunID        uuid.UUID  `json:"run_id"`
	RunItemID    *uuid.UUID `json:"run_item_id"`
	FileName     string     `json:"file_name"`
	Title        string     `json:"title"`
	Status       string     `json:"status"`
	DurationMs   *int       `json:"duration_ms"`
	ErrorMessage string     `json:"error_message,omitempty"`
	ErrorStack   string     `json:"error_stack,omitempty"`
	RetryCount   int        `json:"retry_count"`
	CreatedAt    time.Time  `json:"created_at"`
}

type RunReport struct {
	ID             uuid.UUID `json:"id"`
	RunID          uuid.UUID `json:"run_id"`
	Passed         int       `json:"passed"`
	Failed         int       `json:"failed"`
	Skipped        int       `json:"skipped"`
	TimedOut       int       `json:"timed_out"`
	Total          int       `json:"total"`
	DurationMs     *int      `json:"duration_ms"`
	ReportURL      string    `json:"report_url"`
	ConsoleErrors  int       `json:"console_errors"`
	APIErrors      int       `json:"api_errors"`
	FailedRequests int       `json:"failed_requests"`
	PageErrors     int       `json:"page_errors"`
	CreatedAt      time.Time `json:"created_at"`
}

type RunAttachment struct {
	ID         uuid.UUID `json:"id"`
	RunItemID  uuid.UUID `json:"run_item_id"`
	Type       string    `json:"type"`
	StorageURL string    `json:"storage_url"`
	CreatedAt  time.Time `json:"created_at"`
}

// ── RunQueries ────────────────────────────────────────────────────────────────

type RunQueries struct {
	db *pgxpool.Pool
}

func NewRunQueries(db *pgxpool.Pool) *RunQueries {
	return &RunQueries{db: db}
}

// Create inserts a new queued run record with temporary credentials.
func (q *RunQueries) Create(ctx context.Context, orgID uuid.UUID, envID *uuid.UUID, triggeredBy *uuid.UUID, label string, credentialsJSON []byte) (*TestRun, error) {
	var r TestRun
	err := q.db.QueryRow(ctx, `
		INSERT INTO test_runs (org_id, environment_id, triggered_by, label, credentials_tmp)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, org_id, pipeline_id, environment_id, triggered_by,
		          status, label, COALESCE(error_message,''), started_at, completed_at, created_at
	`, orgID, envID, triggeredBy, label, credentialsJSON).Scan(
		&r.ID, &r.OrgID, &r.PipelineID, &r.EnvironmentID, &r.TriggeredBy,
		&r.Status, &r.Label, &r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create run: %w", err)
	}
	return &r, nil
}

// GetByID returns a run by UUID.
func (q *RunQueries) GetByID(ctx context.Context, id uuid.UUID) (*TestRun, error) {
	var r TestRun
	err := q.db.QueryRow(ctx, `
		SELECT id, org_id, pipeline_id, environment_id, triggered_by,
		       status, label, COALESCE(error_message,''), started_at, completed_at, created_at
		FROM test_runs WHERE id = $1
	`, id).Scan(
		&r.ID, &r.OrgID, &r.PipelineID, &r.EnvironmentID, &r.TriggeredBy,
		&r.Status, &r.Label, &r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get run by id: %w", err)
	}
	return &r, nil
}

// GetCredentials reads the temporary credentials and immediately clears them.
// This is the one and only time credentials are ever read from the DB.
func (q *RunQueries) GetCredentials(ctx context.Context, runID uuid.UUID) ([]byte, error) {
	tx, err := q.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var creds []byte
	if err := tx.QueryRow(ctx,
		`SELECT credentials_tmp FROM test_runs WHERE id = $1`, runID,
	).Scan(&creds); err != nil {
		return nil, fmt.Errorf("read credentials: %w", err)
	}

	// Immediately clear — credentials exist in DB only until runner picks up
	if _, err := tx.Exec(ctx,
		`UPDATE test_runs SET credentials_tmp = NULL WHERE id = $1`, runID,
	); err != nil {
		return nil, fmt.Errorf("clear credentials: %w", err)
	}

	return creds, tx.Commit(ctx)
}

// List returns paginated runs for an org with optional status filter,
// plus the total count matching the filter (for pagination).
func (q *RunQueries) List(ctx context.Context, orgID uuid.UUID, status string, limit, offset int) ([]TestRun, int, error) {
	// Qualify with the tr alias — the list query joins environments (which also
	// has an org_id/status-free schema), so an unqualified org_id is ambiguous.
	where := "WHERE tr.org_id = $1"
	args := []any{orgID}

	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND tr.status = $%d", len(args))
	}

	// Total count for pagination
	var total int
	if err := q.db.QueryRow(ctx,
		fmt.Sprintf("SELECT COUNT(*) FROM test_runs tr %s", where), args...,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count runs: %w", err)
	}

	countArgs := len(args)
	args = append(args, limit, offset)
	query := fmt.Sprintf(`
		SELECT tr.id, tr.org_id, tr.pipeline_id, tr.environment_id, tr.triggered_by,
		       tr.status, tr.label, COALESCE(tr.error_message,''),
		       tr.started_at, tr.completed_at, tr.created_at,
		       COALESCE(e.name, '')
		FROM test_runs tr
		LEFT JOIN environments e ON e.id = tr.environment_id
		%s
		ORDER BY tr.created_at DESC LIMIT $%d OFFSET $%d`,
		where, countArgs+1, countArgs+2,
	)

	rows, err := q.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list runs: %w", err)
	}
	defer rows.Close()

	var runs []TestRun
	for rows.Next() {
		var r TestRun
		if err := rows.Scan(
			&r.ID, &r.OrgID, &r.PipelineID, &r.EnvironmentID, &r.TriggeredBy,
			&r.Status, &r.Label, &r.ErrorMessage,
			&r.StartedAt, &r.CompletedAt, &r.CreatedAt,
			&r.EnvironmentName,
		); err != nil {
			return nil, 0, err
		}
		runs = append(runs, r)
	}
	return runs, total, rows.Err()
}

// ReconcileStuckRuns marks any runs left in a non-terminal state ('queued' or
// 'running') as 'failed'. The run queue is in-memory only, so a backend
// restart/crash orphans whatever was mid-flight — those runs would otherwise
// display as "running" forever. Called once on startup before workers launch.
// It also fails the orphaned runs' still-pending items. Returns the number of
// runs reconciled.
func (q *RunQueries) ReconcileStuckRuns(ctx context.Context) (int64, error) {
	const msg = "Run interrupted by a server restart and could not be recovered."

	// Fail the items of any non-terminal run first.
	if _, err := q.db.Exec(ctx, `
		UPDATE run_items SET status = 'failed', completed_at = NOW()
		WHERE status IN ('queued', 'running')
		  AND run_id IN (SELECT id FROM test_runs WHERE status IN ('queued', 'running'))
	`); err != nil {
		return 0, fmt.Errorf("reconcile run items: %w", err)
	}

	tag, err := q.db.Exec(ctx, `
		UPDATE test_runs
		SET status = 'failed',
		    error_message = COALESCE(NULLIF(error_message, ''), $1),
		    completed_at = NOW()
		WHERE status IN ('queued', 'running')
	`, msg)
	if err != nil {
		return 0, fmt.Errorf("reconcile stuck runs: %w", err)
	}
	return tag.RowsAffected(), nil
}

// SetErrorMessage records why a run failed so the dashboard can surface it.
func (q *RunQueries) SetErrorMessage(ctx context.Context, id uuid.UUID, msg string) error {
	_, err := q.db.Exec(ctx,
		`UPDATE test_runs SET error_message = $2 WHERE id = $1`, id, msg)
	return err
}

// UpdateStatus sets run status and timestamps.
func (q *RunQueries) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	var err error
	switch status {
	case "running":
		_, err = q.db.Exec(ctx,
			`UPDATE test_runs SET status = $2, started_at = NOW() WHERE id = $1`, id, status)
	case "done", "failed", "stopped":
		_, err = q.db.Exec(ctx,
			`UPDATE test_runs SET status = $2, completed_at = NOW() WHERE id = $1`, id, status)
	default:
		_, err = q.db.Exec(ctx,
			`UPDATE test_runs SET status = $2 WHERE id = $1`, id, status)
	}
	return err
}

// ── Run Items ─────────────────────────────────────────────────────────────────

// CreateItem inserts a queued run item for a single test case.
func (q *RunQueries) CreateItem(ctx context.Context, runID uuid.UUID, testCaseID *uuid.UUID, pipelineStep *int) (*RunItem, error) {
	var item RunItem
	err := q.db.QueryRow(ctx, `
		INSERT INTO run_items (run_id, test_case_id, pipeline_step, status)
		VALUES ($1, $2, $3, 'queued')
		RETURNING id, run_id, test_case_id, pipeline_step, status,
		          duration_ms,
		          COALESCE(error_message, '') AS error_message,
		          COALESCE(error_stack,   '') AS error_stack,
		          retry_count, started_at, completed_at
	`, runID, testCaseID, pipelineStep).Scan(
		&item.ID, &item.RunID, &item.TestCaseID, &item.PipelineStep, &item.Status,
		&item.DurationMs, &item.ErrorMessage, &item.ErrorStack, &item.RetryCount,
		&item.StartedAt, &item.CompletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create run item: %w", err)
	}
	return &item, nil
}

// UpdateItem updates a run item's result after execution.
func (q *RunQueries) UpdateItem(ctx context.Context, id uuid.UUID, status string, durationMs int, errorMsg, errorStack string) error {
	_, err := q.db.Exec(ctx, `
		UPDATE run_items
		SET status        = $2,
		    duration_ms   = $3,
		    error_message = $4,
		    error_stack   = $5,
		    completed_at  = NOW()
		WHERE id = $1
	`, id, status, durationMs, errorMsg, errorStack)
	return err
}

// FailItems marks all queued run_items for a run as failed.
// Called when the run itself fails before any test executes.
func (q *RunQueries) FailItems(ctx context.Context, runID uuid.UUID) error {
	_, err := q.db.Exec(ctx, `
		UPDATE run_items SET status = 'failed', completed_at = NOW()
		WHERE run_id = $1 AND status = 'queued'
	`, runID)
	return err
}

// ListItems returns all items for a run with test case name joined.
func (q *RunQueries) ListItems(ctx context.Context, runID uuid.UUID) ([]RunItem, error) {
	rows, err := q.db.Query(ctx, `
		SELECT ri.id, ri.run_id, ri.test_case_id, ri.pipeline_step, ri.status,
		       ri.duration_ms,
		       COALESCE(ri.error_message, '') AS error_message,
		       COALESCE(ri.error_stack,   '') AS error_stack,
		       ri.retry_count,
		       ri.started_at, ri.completed_at,
		       COALESCE(tc.name, '') AS test_case_name
		FROM run_items ri
		LEFT JOIN test_cases tc ON tc.id = ri.test_case_id
		WHERE ri.run_id = $1
		ORDER BY ri.started_at ASC NULLS LAST
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("list run items: %w", err)
	}
	defer rows.Close()

	var items []RunItem
	for rows.Next() {
		var item RunItem
		if err := rows.Scan(
			&item.ID, &item.RunID, &item.TestCaseID, &item.PipelineStep, &item.Status,
			&item.DurationMs, &item.ErrorMessage, &item.ErrorStack, &item.RetryCount,
			&item.StartedAt, &item.CompletedAt, &item.TestCaseName,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ── Per-test results ──────────────────────────────────────────────────────────

// SaveTestResult inserts one individual test() result parsed from the Playwright
// report. runItemID links it to the owning spec's run_item when known.
func (q *RunQueries) SaveTestResult(ctx context.Context, runID uuid.UUID, runItemID *uuid.UUID, fileName, title, status string, durationMs int, errorMsg, errorStack string, retryCount int) error {
	_, err := q.db.Exec(ctx, `
		INSERT INTO run_test_results
		  (run_id, run_item_id, file_name, title, status, duration_ms,
		   error_message, error_stack, retry_count)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, runID, runItemID, fileName, title, status, durationMs, errorMsg, errorStack, retryCount)
	return err
}

// ListTestResults returns every per-test result for a run, ordered by spec.
func (q *RunQueries) ListTestResults(ctx context.Context, runID uuid.UUID) ([]RunTestResult, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, run_id, run_item_id, file_name, title, status, duration_ms,
		       COALESCE(error_message, '') AS error_message,
		       COALESCE(error_stack,   '') AS error_stack,
		       retry_count, created_at
		FROM run_test_results
		WHERE run_id = $1
		ORDER BY file_name ASC, created_at ASC
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("list run test results: %w", err)
	}
	defer rows.Close()

	var results []RunTestResult
	for rows.Next() {
		var tr RunTestResult
		if err := rows.Scan(
			&tr.ID, &tr.RunID, &tr.RunItemID, &tr.FileName, &tr.Title, &tr.Status,
			&tr.DurationMs, &tr.ErrorMessage, &tr.ErrorStack, &tr.RetryCount, &tr.CreatedAt,
		); err != nil {
			return nil, err
		}
		results = append(results, tr)
	}
	return results, rows.Err()
}

// ── Reports ───────────────────────────────────────────────────────────────────

// SaveReport inserts or updates the aggregated run report.
func (q *RunQueries) SaveReport(ctx context.Context, runID uuid.UUID, passed, failed, skipped, timedOut, total, durationMs int, reportURL string, consoleErrors, apiErrors, failedRequests, pageErrors int) error {
	_, err := q.db.Exec(ctx, `
		INSERT INTO run_reports
		  (run_id, passed, failed, skipped, timed_out, total, duration_ms,
		   report_url, console_errors, api_errors, failed_requests, page_errors)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (run_id) DO UPDATE
		  SET passed          = EXCLUDED.passed,
		      failed          = EXCLUDED.failed,
		      skipped         = EXCLUDED.skipped,
		      timed_out       = EXCLUDED.timed_out,
		      total           = EXCLUDED.total,
		      duration_ms     = EXCLUDED.duration_ms,
		      report_url      = EXCLUDED.report_url,
		      console_errors  = EXCLUDED.console_errors,
		      api_errors      = EXCLUDED.api_errors,
		      failed_requests = EXCLUDED.failed_requests,
		      page_errors     = EXCLUDED.page_errors
	`, runID, passed, failed, skipped, timedOut, total, durationMs,
		reportURL, consoleErrors, apiErrors, failedRequests, pageErrors)
	return err
}

// GetReport returns the report for a run.
func (q *RunQueries) GetReport(ctx context.Context, runID uuid.UUID) (*RunReport, error) {
	var rr RunReport
	err := q.db.QueryRow(ctx, `
		SELECT id, run_id, passed, failed, skipped, timed_out, total,
		       duration_ms, report_url, console_errors, api_errors,
		       failed_requests, page_errors, created_at
		FROM run_reports WHERE run_id = $1
	`, runID).Scan(
		&rr.ID, &rr.RunID, &rr.Passed, &rr.Failed, &rr.Skipped, &rr.TimedOut,
		&rr.Total, &rr.DurationMs, &rr.ReportURL, &rr.ConsoleErrors,
		&rr.APIErrors, &rr.FailedRequests, &rr.PageErrors, &rr.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get report: %w", err)
	}
	return &rr, nil
}

// SaveAttachment records a screenshot, trace, or video for a run item.
func (q *RunQueries) SaveAttachment(ctx context.Context, runItemID uuid.UUID, attachType, storageURL string) error {
	_, err := q.db.Exec(ctx, `
		INSERT INTO run_attachments (run_item_id, type, storage_url)
		VALUES ($1, $2, $3)
	`, runItemID, attachType, storageURL)
	return err
}

// ListAttachments returns all attachments for a run (via run_items join).
func (q *RunQueries) ListAttachments(ctx context.Context, runID uuid.UUID) ([]RunAttachment, error) {
	rows, err := q.db.Query(ctx, `
		SELECT ra.id, ra.run_item_id, ra.type, ra.storage_url, ra.created_at
		FROM run_attachments ra
		JOIN run_items ri ON ri.id = ra.run_item_id
		WHERE ri.run_id = $1
		ORDER BY ra.created_at ASC
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	defer rows.Close()

	var list []RunAttachment
	for rows.Next() {
		var a RunAttachment
		if err := rows.Scan(&a.ID, &a.RunItemID, &a.Type, &a.StorageURL, &a.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// TrendData is used by the reports/trends endpoint.
type TrendData struct {
	Date       string  `json:"date"`
	Passed     int     `json:"passed"`
	Failed     int     `json:"failed"`
	Total      int     `json:"total"`
	PassRate   float64 `json:"pass_rate"`
}

// GetTrend returns daily pass/fail counts for the last N days.
func (q *RunQueries) GetTrend(ctx context.Context, orgID uuid.UUID, days int) ([]TrendData, error) {
	rows, err := q.db.Query(ctx, `
		SELECT
		  DATE(tr.created_at)::TEXT AS date,
		  COALESCE(SUM(rr.passed), 0)  AS passed,
		  COALESCE(SUM(rr.failed), 0)  AS failed,
		  COALESCE(SUM(rr.total),  0)  AS total
		FROM test_runs tr
		LEFT JOIN run_reports rr ON rr.run_id = tr.id
		WHERE tr.org_id = $1
		  AND tr.created_at >= NOW() - make_interval(days => $2::INT)
		  AND tr.status IN ('done', 'failed')
		GROUP BY DATE(tr.created_at)
		ORDER BY DATE(tr.created_at) ASC
	`, orgID, days)
	if err != nil {
		return nil, fmt.Errorf("get trend: %w", err)
	}
	defer rows.Close()

	var trend []TrendData
	for rows.Next() {
		var d TrendData
		if err := rows.Scan(&d.Date, &d.Passed, &d.Failed, &d.Total); err != nil {
			return nil, err
		}
		if d.Total > 0 {
			d.PassRate = float64(d.Passed) / float64(d.Total) * 100
		}
		trend = append(trend, d)
	}
	return trend, rows.Err()
}
