package queries

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type Flow struct {
	ID          uuid.UUID  `json:"id"`
	OrgID       uuid.UUID  `json:"org_id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	IsTemplate  bool       `json:"is_template"`
	CreatedBy   *uuid.UUID `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	// Computed
	StepCount int `json:"step_count,omitempty"`
}

type FlowStep struct {
	ID         uuid.UUID  `json:"id"`
	FlowID     uuid.UUID  `json:"flow_id"`
	Position   int        `json:"position"`
	Name       string     `json:"name"`
	Product    string     `json:"product"`
	TestCaseID *uuid.UUID `json:"test_case_id"`
	FolderID   *uuid.UUID `json:"folder_id"`
	EnvInputs  []byte     `json:"env_inputs"`
	EnvOutputs []byte     `json:"env_outputs"`
	CreatedAt  time.Time  `json:"created_at"`
	// Joined display fields
	TestCaseName string `json:"test_case_name,omitempty"`
	FolderName   string `json:"folder_name,omitempty"`
}

type FlowRun struct {
	ID          uuid.UUID  `json:"id"`
	FlowID      uuid.UUID  `json:"flow_id"`
	OrgID       uuid.UUID  `json:"org_id"`
	Status      string     `json:"status"`
	StartedBy   *uuid.UUID `json:"started_by"`
	SharedState []byte     `json:"shared_state"`
	StartedAt   *time.Time `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	CreatedAt   time.Time  `json:"created_at"`
	// Joined
	FlowName string `json:"flow_name,omitempty"`
}

type FlowStepRun struct {
	ID         uuid.UUID  `json:"id"`
	FlowRunID  uuid.UUID  `json:"flow_run_id"`
	StepID     uuid.UUID  `json:"step_id"`
	RunID      *uuid.UUID `json:"run_id"`
	Status     string     `json:"status"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at"`
	// Joined display fields
	StepName    string `json:"step_name,omitempty"`
	StepProduct string `json:"step_product,omitempty"`
	Position    int    `json:"position,omitempty"`
}

// ── FlowQueries ───────────────────────────────────────────────────────────────

type FlowQueries struct {
	db *pgxpool.Pool
}

func NewFlowQueries(db *pgxpool.Pool) *FlowQueries {
	return &FlowQueries{db: db}
}

// ── Flows CRUD ────────────────────────────────────────────────────────────────

func (q *FlowQueries) ListByOrg(ctx context.Context, orgID uuid.UUID) ([]Flow, error) {
	rows, err := q.db.Query(ctx, `
		SELECT f.id, f.org_id, f.name, f.description, f.is_template, f.created_by, f.created_at, f.updated_at,
		       COUNT(s.id) AS step_count
		FROM flows f
		LEFT JOIN flow_steps s ON s.flow_id = f.id
		WHERE f.org_id = $1
		GROUP BY f.id
		ORDER BY f.created_at DESC
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Flow
	for rows.Next() {
		var fl Flow
		if err := rows.Scan(&fl.ID, &fl.OrgID, &fl.Name, &fl.Description, &fl.IsTemplate,
			&fl.CreatedBy, &fl.CreatedAt, &fl.UpdatedAt, &fl.StepCount); err != nil {
			return nil, err
		}
		out = append(out, fl)
	}
	return out, nil
}

func (q *FlowQueries) GetByID(ctx context.Context, flowID uuid.UUID) (*Flow, error) {
	var fl Flow
	err := q.db.QueryRow(ctx, `
		SELECT id, org_id, name, description, is_template, created_by, created_at, updated_at
		FROM flows WHERE id = $1
	`, flowID).Scan(&fl.ID, &fl.OrgID, &fl.Name, &fl.Description, &fl.IsTemplate,
		&fl.CreatedBy, &fl.CreatedAt, &fl.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &fl, nil
}

func (q *FlowQueries) Create(ctx context.Context, orgID uuid.UUID, userID *uuid.UUID, name, description string) (*Flow, error) {
	var fl Flow
	err := q.db.QueryRow(ctx, `
		INSERT INTO flows (org_id, name, description, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id, org_id, name, description, is_template, created_by, created_at, updated_at
	`, orgID, name, description, userID).Scan(&fl.ID, &fl.OrgID, &fl.Name, &fl.Description,
		&fl.IsTemplate, &fl.CreatedBy, &fl.CreatedAt, &fl.UpdatedAt)
	return &fl, err
}

func (q *FlowQueries) Update(ctx context.Context, flowID uuid.UUID, name, description string) error {
	_, err := q.db.Exec(ctx, `
		UPDATE flows SET name = $2, description = $3, updated_at = NOW()
		WHERE id = $1
	`, flowID, name, description)
	return err
}

func (q *FlowQueries) Delete(ctx context.Context, flowID uuid.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM flows WHERE id = $1`, flowID)
	return err
}

// ── Flow Steps ────────────────────────────────────────────────────────────────

func (q *FlowQueries) ListSteps(ctx context.Context, flowID uuid.UUID) ([]FlowStep, error) {
	rows, err := q.db.Query(ctx, `
		SELECT s.id, s.flow_id, s.position, s.name, s.product, s.test_case_id, s.folder_id,
		       s.env_inputs, s.env_outputs, s.created_at,
		       COALESCE(tc.name, '') AS test_case_name,
		       COALESCE(fo.name, '') AS folder_name
		FROM flow_steps s
		LEFT JOIN test_cases  tc ON tc.id = s.test_case_id
		LEFT JOIN test_folders fo ON fo.id = s.folder_id
		WHERE s.flow_id = $1
		ORDER BY s.position
	`, flowID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FlowStep
	for rows.Next() {
		var st FlowStep
		if err := rows.Scan(&st.ID, &st.FlowID, &st.Position, &st.Name, &st.Product,
			&st.TestCaseID, &st.FolderID, &st.EnvInputs, &st.EnvOutputs, &st.CreatedAt,
			&st.TestCaseName, &st.FolderName); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, nil
}

func (q *FlowQueries) AddStep(ctx context.Context, flowID uuid.UUID, position int, name, product string,
	testCaseID, folderID *uuid.UUID, envInputs, envOutputs []byte) (*FlowStep, error) {

	if envInputs == nil {
		envInputs = []byte("[]")
	}
	if envOutputs == nil {
		envOutputs = []byte("[]")
	}

	var st FlowStep
	err := q.db.QueryRow(ctx, `
		INSERT INTO flow_steps (flow_id, position, name, product, test_case_id, folder_id, env_inputs, env_outputs)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, flow_id, position, name, product, test_case_id, folder_id, env_inputs, env_outputs, created_at
	`, flowID, position, name, product, testCaseID, folderID, envInputs, envOutputs).Scan(
		&st.ID, &st.FlowID, &st.Position, &st.Name, &st.Product,
		&st.TestCaseID, &st.FolderID, &st.EnvInputs, &st.EnvOutputs, &st.CreatedAt)
	return &st, err
}

func (q *FlowQueries) UpdateStep(ctx context.Context, stepID uuid.UUID, name, product string,
	testCaseID, folderID *uuid.UUID, envInputs, envOutputs []byte) error {

	if envInputs == nil {
		envInputs = []byte("[]")
	}
	if envOutputs == nil {
		envOutputs = []byte("[]")
	}

	_, err := q.db.Exec(ctx, `
		UPDATE flow_steps
		SET name = $2, product = $3, test_case_id = $4, folder_id = $5,
		    env_inputs = $6, env_outputs = $7
		WHERE id = $1
	`, stepID, name, product, testCaseID, folderID, envInputs, envOutputs)
	return err
}

func (q *FlowQueries) DeleteStep(ctx context.Context, stepID uuid.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM flow_steps WHERE id = $1`, stepID)
	return err
}

func (q *FlowQueries) ReorderSteps(ctx context.Context, flowID uuid.UUID, stepIDs []uuid.UUID) error {
	for i, id := range stepIDs {
		if _, err := q.db.Exec(ctx, `
			UPDATE flow_steps SET position = $1 WHERE id = $2 AND flow_id = $3
		`, i+1, id, flowID); err != nil {
			return err
		}
	}
	return nil
}

// ── Flow Runs ─────────────────────────────────────────────────────────────────

func (q *FlowQueries) CreateRun(ctx context.Context, flowID, orgID uuid.UUID, startedBy *uuid.UUID) (*FlowRun, error) {
	var fr FlowRun
	err := q.db.QueryRow(ctx, `
		INSERT INTO flow_runs (flow_id, org_id, started_by)
		VALUES ($1, $2, $3)
		RETURNING id, flow_id, org_id, status, started_by, shared_state, started_at, finished_at, created_at
	`, flowID, orgID, startedBy).Scan(&fr.ID, &fr.FlowID, &fr.OrgID, &fr.Status, &fr.StartedBy,
		&fr.SharedState, &fr.StartedAt, &fr.FinishedAt, &fr.CreatedAt)
	return &fr, err
}

func (q *FlowQueries) GetRunByID(ctx context.Context, runID uuid.UUID) (*FlowRun, error) {
	var fr FlowRun
	err := q.db.QueryRow(ctx, `
		SELECT fr.id, fr.flow_id, fr.org_id, fr.status, fr.started_by,
		       fr.shared_state, fr.started_at, fr.finished_at, fr.created_at,
		       COALESCE(f.name, '') AS flow_name
		FROM flow_runs fr
		LEFT JOIN flows f ON f.id = fr.flow_id
		WHERE fr.id = $1
	`, runID).Scan(&fr.ID, &fr.FlowID, &fr.OrgID, &fr.Status, &fr.StartedBy,
		&fr.SharedState, &fr.StartedAt, &fr.FinishedAt, &fr.CreatedAt, &fr.FlowName)
	return &fr, err
}

func (q *FlowQueries) ListRunsByOrg(ctx context.Context, orgID uuid.UUID, limit, offset int) ([]FlowRun, int, error) {
	var total int
	err := q.db.QueryRow(ctx, `SELECT COUNT(*) FROM flow_runs WHERE org_id = $1`, orgID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	rows, err := q.db.Query(ctx, `
		SELECT fr.id, fr.flow_id, fr.org_id, fr.status, fr.started_by,
		       fr.shared_state, fr.started_at, fr.finished_at, fr.created_at,
		       COALESCE(f.name, '') AS flow_name
		FROM flow_runs fr
		LEFT JOIN flows f ON f.id = fr.flow_id
		WHERE fr.org_id = $1
		ORDER BY fr.created_at DESC
		LIMIT $2 OFFSET $3
	`, orgID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []FlowRun
	for rows.Next() {
		var fr FlowRun
		if err := rows.Scan(&fr.ID, &fr.FlowID, &fr.OrgID, &fr.Status, &fr.StartedBy,
			&fr.SharedState, &fr.StartedAt, &fr.FinishedAt, &fr.CreatedAt, &fr.FlowName); err != nil {
			return nil, 0, err
		}
		out = append(out, fr)
	}
	return out, total, nil
}

func (q *FlowQueries) UpdateRunStatus(ctx context.Context, runID uuid.UUID, status string) error {
	_, err := q.db.Exec(ctx, `
		UPDATE flow_runs SET status = $2,
		  started_at  = CASE WHEN $2 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
		  finished_at = CASE WHEN $2 IN ('passed','failed','stopped') THEN NOW() ELSE finished_at END
		WHERE id = $1
	`, runID, status)
	return err
}

func (q *FlowQueries) UpdateSharedState(ctx context.Context, runID uuid.UUID, state map[string]string) error {
	b, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = q.db.Exec(ctx, `UPDATE flow_runs SET shared_state = $2 WHERE id = $1`, runID, b)
	return err
}

// ── Flow Step Runs ────────────────────────────────────────────────────────────

func (q *FlowQueries) CreateStepRun(ctx context.Context, flowRunID, stepID uuid.UUID) (*FlowStepRun, error) {
	var sr FlowStepRun
	err := q.db.QueryRow(ctx, `
		INSERT INTO flow_step_runs (flow_run_id, step_id)
		VALUES ($1, $2)
		RETURNING id, flow_run_id, step_id, run_id, status, started_at, finished_at, created_at
	`, flowRunID, stepID).Scan(&sr.ID, &sr.FlowRunID, &sr.StepID, &sr.RunID,
		&sr.Status, &sr.StartedAt, &sr.FinishedAt, &sr.CreatedAt)
	return &sr, err
}

func (q *FlowQueries) UpdateStepRun(ctx context.Context, stepRunID uuid.UUID, status string, runID *uuid.UUID) error {
	_, err := q.db.Exec(ctx, `
		UPDATE flow_step_runs
		SET status  = $2,
		    run_id  = COALESCE($3, run_id),
		    started_at  = CASE WHEN $2 = 'running'  AND started_at IS NULL THEN NOW() ELSE started_at END,
		    finished_at = CASE WHEN $2 IN ('passed','failed','skipped') THEN NOW() ELSE finished_at END
		WHERE id = $1
	`, stepRunID, status, runID)
	return err
}

func (q *FlowQueries) ListStepRuns(ctx context.Context, flowRunID uuid.UUID) ([]FlowStepRun, error) {
	rows, err := q.db.Query(ctx, `
		SELECT sr.id, sr.flow_run_id, sr.step_id, sr.run_id, sr.status,
		       sr.started_at, sr.finished_at, sr.created_at,
		       s.name AS step_name, s.product AS step_product, s.position
		FROM flow_step_runs sr
		JOIN flow_steps s ON s.id = sr.step_id
		WHERE sr.flow_run_id = $1
		ORDER BY s.position
	`, flowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FlowStepRun
	for rows.Next() {
		var sr FlowStepRun
		if err := rows.Scan(&sr.ID, &sr.FlowRunID, &sr.StepID, &sr.RunID, &sr.Status,
			&sr.StartedAt, &sr.FinishedAt, &sr.CreatedAt,
			&sr.StepName, &sr.StepProduct, &sr.Position); err != nil {
			return nil, err
		}
		out = append(out, sr)
	}
	return out, nil
}
