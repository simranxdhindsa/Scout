package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/google/uuid"
)

// ── Models ────────────────────────────────────────────────────────────────────

type Pipeline struct {
	ID          uuid.UUID      `json:"id"`
	OrgID       uuid.UUID      `json:"org_id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	CreatedBy   *uuid.UUID     `json:"created_by"`
	CreatedAt   time.Time      `json:"created_at"`
	Steps       []PipelineStep `json:"steps,omitempty"`
}

type PipelineStep struct {
	ID            uuid.UUID  `json:"id"`
	PipelineID    uuid.UUID  `json:"pipeline_id"`
	StepOrder     int        `json:"step_order"`
	TargetType    string     `json:"target_type"`
	TargetID      uuid.UUID  `json:"target_id"`
	SubProjectID  *uuid.UUID `json:"sub_project_id"`
	EnvironmentID *uuid.UUID `json:"environment_id"`
	OnFailure     string     `json:"on_failure"`
}

// ── pipelineHandler ───────────────────────────────────────────────────────────

type pipelineHandler struct {
	svc Services
}

func newPipelineHandler(svc Services) *pipelineHandler {
	return &pipelineHandler{svc: svc}
}

// List handles GET /api/v1/orgs/:orgId/pipelines
func (h *pipelineHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	rows, err := h.svc.DB.Query(r.Context(), `
		SELECT id, org_id, name, COALESCE(description,''), created_by, created_at
		FROM pipelines WHERE org_id = $1 ORDER BY created_at DESC
	`, orgID)
	if err != nil {
		writeError(w, "failed to list pipelines", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var pipelines []Pipeline
	for rows.Next() {
		var p Pipeline
		if err := rows.Scan(&p.ID, &p.OrgID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		pipelines = append(pipelines, p)
	}
	if pipelines == nil {
		pipelines = []Pipeline{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"pipelines": pipelines})
}

// Create handles POST /api/v1/orgs/:orgId/pipelines
func (h *pipelineHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		Steps       []PipelineStep `json:"steps"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	tx, err := h.svc.DB.Begin(r.Context())
	if err != nil {
		writeError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var p Pipeline
	err = tx.QueryRow(r.Context(), `
		INSERT INTO pipelines (org_id, name, description, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id, org_id, name, COALESCE(description,''), created_by, created_at
	`, orgID, body.Name, body.Description, claims.UserID).Scan(
		&p.ID, &p.OrgID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to create pipeline", http.StatusInternalServerError)
		return
	}

	for i, step := range body.Steps {
		var s PipelineStep
		err = tx.QueryRow(r.Context(), `
			INSERT INTO pipeline_steps
			  (pipeline_id, step_order, target_type, target_id, sub_project_id, environment_id, on_failure)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, pipeline_id, step_order, target_type, target_id,
			          sub_project_id, environment_id, on_failure
		`, p.ID, i+1, step.TargetType, step.TargetID,
			step.SubProjectID, step.EnvironmentID,
			coalesceString(step.OnFailure, "halt"),
		).Scan(
			&s.ID, &s.PipelineID, &s.StepOrder, &s.TargetType, &s.TargetID,
			&s.SubProjectID, &s.EnvironmentID, &s.OnFailure,
		)
		if err != nil {
			writeError(w, "failed to create pipeline step", http.StatusInternalServerError)
			return
		}
		p.Steps = append(p.Steps, s)
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, "commit error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, p)
}

// Update handles PUT /api/v1/orgs/:orgId/pipelines/:pipelineId
func (h *pipelineHandler) Update(w http.ResponseWriter, r *http.Request) {
	pipelineID, err := uuid.Parse(r.PathValue("pipelineId"))
	if err != nil {
		writeError(w, "invalid pipelineId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		Steps       []PipelineStep `json:"steps"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	tx, err := h.svc.DB.Begin(r.Context())
	if err != nil {
		writeError(w, "db error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var p Pipeline
	err = tx.QueryRow(r.Context(), `
		UPDATE pipelines SET name = $2, description = $3 WHERE id = $1
		RETURNING id, org_id, name, COALESCE(description,''), created_by, created_at
	`, pipelineID, body.Name, body.Description).Scan(
		&p.ID, &p.OrgID, &p.Name, &p.Description, &p.CreatedBy, &p.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to update pipeline", http.StatusInternalServerError)
		return
	}

	// Replace all steps
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM pipeline_steps WHERE pipeline_id = $1`, pipelineID,
	); err != nil {
		writeError(w, "failed to clear pipeline steps", http.StatusInternalServerError)
		return
	}

	for i, step := range body.Steps {
		var s PipelineStep
		err = tx.QueryRow(r.Context(), `
			INSERT INTO pipeline_steps
			  (pipeline_id, step_order, target_type, target_id, sub_project_id, environment_id, on_failure)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, pipeline_id, step_order, target_type, target_id,
			          sub_project_id, environment_id, on_failure
		`, p.ID, i+1, step.TargetType, step.TargetID,
			step.SubProjectID, step.EnvironmentID,
			coalesceString(step.OnFailure, "halt"),
		).Scan(
			&s.ID, &s.PipelineID, &s.StepOrder, &s.TargetType, &s.TargetID,
			&s.SubProjectID, &s.EnvironmentID, &s.OnFailure,
		)
		if err != nil {
			continue
		}
		p.Steps = append(p.Steps, s)
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, "commit error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, p)
}

// Delete handles DELETE /api/v1/orgs/:orgId/pipelines/:pipelineId
func (h *pipelineHandler) Delete(w http.ResponseWriter, r *http.Request) {
	pipelineID, err := uuid.Parse(r.PathValue("pipelineId"))
	if err != nil {
		writeError(w, "invalid pipelineId", http.StatusBadRequest)
		return
	}

	if _, err := h.svc.DB.Exec(r.Context(),
		`DELETE FROM pipelines WHERE id = $1`, pipelineID,
	); err != nil {
		writeError(w, "failed to delete pipeline", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Run handles POST /api/v1/orgs/:orgId/pipelines/:pipelineId/run
func (h *pipelineHandler) Run(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	pipelineID, err := uuid.Parse(r.PathValue("pipelineId"))
	if err != nil {
		writeError(w, "invalid pipelineId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Credentials map[string]string `json:"credentials"`
		Label       string            `json:"label"`
	}
	_ = decodeBody(r, &body)

	var credsJSON []byte
	if len(body.Credentials) > 0 {
		credsJSON, _ = json.Marshal(body.Credentials)
	}

	label := body.Label
	if label == "" {
		label = "pipeline run"
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	run, err := runQ.Create(r.Context(), orgID, nil, &claims.UserID, label, credsJSON)
	if err != nil {
		writeError(w, "failed to create run", http.StatusInternalServerError)
		return
	}

	// Load pipeline steps and create run items
	rows, err := h.svc.DB.Query(r.Context(), `
		SELECT step_order, target_type, target_id
		FROM pipeline_steps WHERE pipeline_id = $1
		ORDER BY step_order ASC
	`, pipelineID)
	if err != nil {
		writeError(w, "failed to load pipeline steps", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	folderQ := queries.NewFolderQueries(h.svc.DB)
	testQ := queries.NewTestQueries(h.svc.DB)

	for rows.Next() {
		var stepOrder int
		var targetType string
		var targetID uuid.UUID
		if err := rows.Scan(&stepOrder, &targetType, &targetID); err != nil {
			continue
		}

		switch targetType {
		case "test_case":
			step := stepOrder
			_, _ = runQ.CreateItem(r.Context(), run.ID, &targetID, &step)
		case "folder":
			folderIDs, _ := folderQ.GetSubtreeIDs(r.Context(), targetID)
			for _, fid := range folderIDs {
				tests, _ := testQ.ListByFolder(r.Context(), fid)
				for _, t := range tests {
					tcID := t.ID
					step := stepOrder
					_, _ = runQ.CreateItem(r.Context(), run.ID, &tcID, &step)
				}
			}
		}
	}

	h.svc.Runner.Enqueue(&runner.RunJob{
		RunID: run.ID,
		OrgID: orgID,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"run_id":      run.ID,
		"pipeline_id": pipelineID,
		"status":      "queued",
	})
}

func coalesceString(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}
