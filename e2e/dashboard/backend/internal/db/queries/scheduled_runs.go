package queries

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ScheduledRunQueries struct {
	db *pgxpool.Pool
}

func NewScheduledRunQueries(db *pgxpool.Pool) *ScheduledRunQueries {
	return &ScheduledRunQueries{db: db}
}

// ── Model ─────────────────────────────────────────────────────────────────────

type ScheduledRun struct {
	ID          uuid.UUID   `json:"id"`
	OrgID       uuid.UUID   `json:"org_id"`
	Label       string      `json:"label"`
	CronExpr    string      `json:"cron_expr"`
	EnvID       *uuid.UUID  `json:"env_id"`
	TestCaseIDs []uuid.UUID `json:"test_case_ids"`
	FolderID    *uuid.UUID  `json:"folder_id"`
	Product     string      `json:"product"`
	Enabled     bool        `json:"enabled"`
	LastRunAt   *time.Time  `json:"last_run_at"`
	NextRunAt   *time.Time  `json:"next_run_at"`
	CreatedBy   *uuid.UUID  `json:"created_by"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

func scanScheduledRun(row interface {
	Scan(dest ...any) error
}) (*ScheduledRun, error) {
	var s ScheduledRun
	var tcRaw []byte
	if err := row.Scan(
		&s.ID, &s.OrgID, &s.Label, &s.CronExpr,
		&s.EnvID, &tcRaw, &s.FolderID, &s.Product,
		&s.Enabled, &s.LastRunAt, &s.NextRunAt,
		&s.CreatedBy, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if tcRaw != nil {
		_ = json.Unmarshal(tcRaw, &s.TestCaseIDs)
	}
	if s.TestCaseIDs == nil {
		s.TestCaseIDs = []uuid.UUID{}
	}
	return &s, nil
}

const scheduledRunCols = `id, org_id, label, cron_expr, env_id, test_case_ids, folder_id, product,
	enabled, last_run_at, next_run_at, created_by, created_at, updated_at`

func (q *ScheduledRunQueries) Create(ctx context.Context,
	orgID uuid.UUID, createdBy *uuid.UUID,
	label, cronExpr, product string,
	envID, folderID *uuid.UUID,
	testCaseIDs []uuid.UUID,
	nextRunAt *time.Time,
) (*ScheduledRun, error) {
	tcJSON, _ := json.Marshal(testCaseIDs)
	row := q.db.QueryRow(ctx, `
		INSERT INTO scheduled_runs
		  (org_id, label, cron_expr, env_id, test_case_ids, folder_id, product, created_by, next_run_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING `+scheduledRunCols,
		orgID, label, cronExpr, envID, tcJSON, folderID, product, createdBy, nextRunAt,
	)
	return scanScheduledRun(row)
}

func (q *ScheduledRunQueries) List(ctx context.Context, orgID uuid.UUID) ([]ScheduledRun, error) {
	rows, err := q.db.Query(ctx,
		`SELECT `+scheduledRunCols+` FROM scheduled_runs WHERE org_id = $1 ORDER BY created_at DESC`,
		orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScheduledRun
	for rows.Next() {
		s, err := scanScheduledRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, nil
}

func (q *ScheduledRunQueries) GetByID(ctx context.Context, id uuid.UUID) (*ScheduledRun, error) {
	return scanScheduledRun(q.db.QueryRow(ctx,
		`SELECT `+scheduledRunCols+` FROM scheduled_runs WHERE id = $1`, id))
}

func (q *ScheduledRunQueries) Update(ctx context.Context, id uuid.UUID,
	label, cronExpr, product string,
	envID, folderID *uuid.UUID,
	testCaseIDs []uuid.UUID,
	enabled bool,
	nextRunAt *time.Time,
) error {
	tcJSON, _ := json.Marshal(testCaseIDs)
	_, err := q.db.Exec(ctx, `
		UPDATE scheduled_runs SET
		  label=$2, cron_expr=$3, env_id=$4, test_case_ids=$5,
		  folder_id=$6, product=$7, enabled=$8, next_run_at=$9, updated_at=NOW()
		WHERE id=$1`,
		id, label, cronExpr, envID, tcJSON, folderID, product, enabled, nextRunAt,
	)
	return err
}

func (q *ScheduledRunQueries) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM scheduled_runs WHERE id = $1`, id)
	return err
}

// ListDue returns all enabled schedules whose next_run_at is in the past.
func (q *ScheduledRunQueries) ListDue(ctx context.Context) ([]ScheduledRun, error) {
	rows, err := q.db.Query(ctx,
		`SELECT `+scheduledRunCols+`
		 FROM scheduled_runs
		 WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= NOW()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScheduledRun
	for rows.Next() {
		s, err := scanScheduledRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, nil
}

func (q *ScheduledRunQueries) MarkFired(ctx context.Context, id uuid.UUID, nextRunAt *time.Time) error {
	_, err := q.db.Exec(ctx, `
		UPDATE scheduled_runs SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW()
		WHERE id = $1`,
		id, nextRunAt)
	return err
}

func (q *ScheduledRunQueries) SetEnabled(ctx context.Context, id uuid.UUID, enabled bool) error {
	_, err := q.db.Exec(ctx, `
		UPDATE scheduled_runs SET enabled = $2, updated_at = NOW() WHERE id = $1`, id, enabled)
	return err
}
