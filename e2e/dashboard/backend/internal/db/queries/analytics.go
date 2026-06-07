package queries

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AnalyticsQueries struct {
	db *pgxpool.Pool
}

func NewAnalyticsQueries(db *pgxpool.Pool) *AnalyticsQueries {
	return &AnalyticsQueries{db: db}
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AnalyticsOverview struct {
	TotalTestCases  int     `json:"total_test_cases"`
	RunsLast7d      int     `json:"runs_last_7d"`
	AvgPassRate7d   float64 `json:"avg_pass_rate_7d"`
	AvgDurationMs   int     `json:"avg_duration_ms"`
	FlakyCount      int     `json:"flaky_count"`
	TotalRunsLast7d int     `json:"total_runs_last_7d"`
}

type FlakyTest struct {
	TestCaseID     uuid.UUID `json:"test_case_id"`
	TestName       string    `json:"test_name"`
	FileName       string    `json:"file_name"`
	FolderName     string    `json:"folder_name"`
	SubProjectName string    `json:"sub_project_name"`
	TotalRuns      int       `json:"total_runs"`
	PassedCount    int       `json:"passed_count"`
	FailedCount    int       `json:"failed_count"`
	PassRate       float64   `json:"pass_rate"`
	LastRunAt      time.Time `json:"last_run_at"`
}

type SlowTest struct {
	TestCaseID     uuid.UUID `json:"test_case_id"`
	TestName       string    `json:"test_name"`
	FileName       string    `json:"file_name"`
	FolderName     string    `json:"folder_name"`
	SubProjectName string    `json:"sub_project_name"`
	RunCount       int       `json:"run_count"`
	AvgDurationMs  int       `json:"avg_duration_ms"`
	MaxDurationMs  int       `json:"max_duration_ms"`
	P95DurationMs  int       `json:"p95_duration_ms"`
}

type TestRunHistory struct {
	RunID       uuid.UUID `json:"run_id"`
	Status      string    `json:"status"`
	DurationMs  *int      `json:"duration_ms"`
	RunAt       time.Time `json:"run_at"`
}

// ── Queries ───────────────────────────────────────────────────────────────────

// GetOverview returns aggregate health metrics for an org.
func (q *AnalyticsQueries) GetOverview(ctx context.Context, orgID uuid.UUID) (*AnalyticsOverview, error) {
	ov := &AnalyticsOverview{}

	// Total distinct test cases that have ever been run in this org
	_ = q.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT tc.id)
		FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		JOIN sub_projects sp ON sp.id = tf.sub_project_id
		JOIN products p ON p.id = sp.product_id
		WHERE p.org_id = $1
	`, orgID).Scan(&ov.TotalTestCases)

	// Runs + avg pass rate in last 7 days
	_ = q.db.QueryRow(ctx, `
		SELECT
		  COUNT(DISTINCT tr.id),
		  COALESCE(ROUND(AVG(
		    CASE WHEN rr.total > 0 THEN rr.passed::FLOAT / rr.total * 100 END
		  )::NUMERIC, 1), 0)
		FROM test_runs tr
		LEFT JOIN run_reports rr ON rr.run_id = tr.id
		WHERE tr.org_id = $1
		  AND tr.status IN ('done','failed')
		  AND tr.created_at > NOW() - INTERVAL '7 days'
	`, orgID).Scan(&ov.TotalRunsLast7d, &ov.AvgPassRate7d)

	// Avg duration of individual test items in last 7 days
	_ = q.db.QueryRow(ctx, `
		SELECT COALESCE(ROUND(AVG(ri.duration_ms)), 0)
		FROM run_items ri
		JOIN test_runs tr ON tr.id = ri.run_id
		WHERE tr.org_id = $1
		  AND ri.duration_ms IS NOT NULL
		  AND ri.duration_ms > 0
		  AND tr.created_at > NOW() - INTERVAL '7 days'
	`, orgID).Scan(&ov.AvgDurationMs)

	// Count of flaky tests (has ≥1 pass AND ≥1 fail in last 30 days, min 3 runs)
	_ = q.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
		  SELECT tc.id
		  FROM test_cases tc
		  JOIN test_folders tf ON tf.id = tc.folder_id
		  JOIN sub_projects sp ON sp.id = tf.sub_project_id
		  JOIN products p ON p.id = sp.product_id
		  JOIN run_items ri ON ri.test_case_id = tc.id
		  JOIN test_runs tr ON tr.id = ri.run_id
		  WHERE p.org_id = $1
		    AND tr.created_at > NOW() - INTERVAL '30 days'
		    AND ri.status IN ('passed','failed')
		  GROUP BY tc.id
		  HAVING COUNT(ri.id) >= 3
		     AND COUNT(ri.id) FILTER (WHERE ri.status = 'failed') > 0
		     AND COUNT(ri.id) FILTER (WHERE ri.status = 'passed') > 0
		) flaky
	`, orgID).Scan(&ov.FlakyCount)

	// runs_last_7d = number of individual test case executions last 7 days
	_ = q.db.QueryRow(ctx, `
		SELECT COUNT(ri.id)
		FROM run_items ri
		JOIN test_runs tr ON tr.id = ri.run_id
		WHERE tr.org_id = $1
		  AND tr.created_at > NOW() - INTERVAL '7 days'
		  AND ri.status IN ('passed','failed','skipped','timedOut')
	`, orgID).Scan(&ov.RunsLast7d)

	return ov, nil
}

// GetFlakyTests returns test cases with mixed pass/fail results over the last 30 days.
func (q *AnalyticsQueries) GetFlakyTests(ctx context.Context, orgID uuid.UUID, limit int) ([]FlakyTest, error) {
	rows, err := q.db.Query(ctx, `
		SELECT
		  tc.id,
		  tc.name,
		  tc.file_name,
		  tf.name  AS folder_name,
		  sp.name  AS sub_project_name,
		  COUNT(ri.id)                                              AS total_runs,
		  COUNT(ri.id) FILTER (WHERE ri.status = 'passed')         AS passed_count,
		  COUNT(ri.id) FILTER (WHERE ri.status = 'failed')         AS failed_count,
		  ROUND(
		    COUNT(ri.id) FILTER (WHERE ri.status = 'passed')::NUMERIC
		    / NULLIF(COUNT(ri.id), 0) * 100, 1
		  )                                                         AS pass_rate,
		  MAX(tr.created_at)                                        AS last_run_at
		FROM test_cases tc
		JOIN test_folders tf  ON tf.id  = tc.folder_id
		JOIN sub_projects sp  ON sp.id  = tf.sub_project_id
		JOIN products p       ON p.id   = sp.product_id
		JOIN run_items ri     ON ri.test_case_id = tc.id
		JOIN test_runs tr     ON tr.id  = ri.run_id
		WHERE p.org_id = $1
		  AND tr.created_at > NOW() - INTERVAL '30 days'
		  AND ri.status IN ('passed','failed')
		GROUP BY tc.id, tc.name, tc.file_name, tf.name, sp.name
		HAVING COUNT(ri.id) >= 3
		   AND COUNT(ri.id) FILTER (WHERE ri.status = 'failed') > 0
		   AND COUNT(ri.id) FILTER (WHERE ri.status = 'passed') > 0
		ORDER BY
		  -- Sort by how "mixed" the results are (closest to 50/50 = most flaky)
		  LEAST(
		    COUNT(ri.id) FILTER (WHERE ri.status = 'failed'),
		    COUNT(ri.id) FILTER (WHERE ri.status = 'passed')
		  )::FLOAT / NULLIF(COUNT(ri.id), 0) DESC,
		  COUNT(ri.id) DESC
		LIMIT $2
	`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []FlakyTest
	for rows.Next() {
		var f FlakyTest
		if err := rows.Scan(
			&f.TestCaseID, &f.TestName, &f.FileName,
			&f.FolderName, &f.SubProjectName,
			&f.TotalRuns, &f.PassedCount, &f.FailedCount,
			&f.PassRate, &f.LastRunAt,
		); err != nil {
			return nil, err
		}
		results = append(results, f)
	}
	return results, rows.Err()
}

// GetSlowTests returns the slowest test cases by average duration over the last 30 days.
func (q *AnalyticsQueries) GetSlowTests(ctx context.Context, orgID uuid.UUID, limit int) ([]SlowTest, error) {
	rows, err := q.db.Query(ctx, `
		SELECT
		  tc.id,
		  tc.name,
		  tc.file_name,
		  tf.name  AS folder_name,
		  sp.name  AS sub_project_name,
		  COUNT(ri.id)                                              AS run_count,
		  ROUND(AVG(ri.duration_ms))::INT                          AS avg_duration_ms,
		  MAX(ri.duration_ms)                                       AS max_duration_ms,
		  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ri.duration_ms)::INT AS p95_duration_ms
		FROM test_cases tc
		JOIN test_folders tf  ON tf.id  = tc.folder_id
		JOIN sub_projects sp  ON sp.id  = tf.sub_project_id
		JOIN products p       ON p.id   = sp.product_id
		JOIN run_items ri     ON ri.test_case_id = tc.id
		JOIN test_runs tr     ON tr.id  = ri.run_id
		WHERE p.org_id = $1
		  AND ri.duration_ms IS NOT NULL
		  AND ri.duration_ms > 0
		  AND tr.created_at > NOW() - INTERVAL '30 days'
		GROUP BY tc.id, tc.name, tc.file_name, tf.name, sp.name
		HAVING COUNT(ri.id) >= 2
		ORDER BY avg_duration_ms DESC
		LIMIT $2
	`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SlowTest
	for rows.Next() {
		var s SlowTest
		if err := rows.Scan(
			&s.TestCaseID, &s.TestName, &s.FileName,
			&s.FolderName, &s.SubProjectName,
			&s.RunCount, &s.AvgDurationMs, &s.MaxDurationMs, &s.P95DurationMs,
		); err != nil {
			return nil, err
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// GetTestHistory returns the last N run results for a specific test case.
func (q *AnalyticsQueries) GetTestHistory(ctx context.Context, orgID, testCaseID uuid.UUID, limit int) ([]TestRunHistory, error) {
	rows, err := q.db.Query(ctx, `
		SELECT tr.id, ri.status, ri.duration_ms, tr.created_at
		FROM run_items ri
		JOIN test_runs tr ON tr.id = ri.run_id
		WHERE ri.test_case_id = $1
		  AND tr.org_id = $2
		  AND ri.status IN ('passed','failed','skipped','timedOut')
		ORDER BY tr.created_at DESC
		LIMIT $3
	`, testCaseID, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []TestRunHistory
	for rows.Next() {
		var h TestRunHistory
		if err := rows.Scan(&h.RunID, &h.Status, &h.DurationMs, &h.RunAt); err != nil {
			return nil, err
		}
		results = append(results, h)
	}
	return results, rows.Err()
}
