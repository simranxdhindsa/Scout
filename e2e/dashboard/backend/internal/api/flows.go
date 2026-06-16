package api

import (
	"encoding/json"
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/google/uuid"
)

type flowHandler struct {
	svc Services
}

func newFlowHandler(svc Services) *flowHandler {
	return &flowHandler{svc: svc}
}

// List handles GET /api/v1/orgs/:orgId/flows
func (h *flowHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	flows, err := flowQ.ListByOrg(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to list flows", http.StatusInternalServerError)
		return
	}
	if flows == nil {
		flows = []queries.Flow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"flows": flows})
}

// Create handles POST /api/v1/orgs/:orgId/flows
func (h *flowHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	flowQ := queries.NewFlowQueries(h.svc.DB)
	flow, err := flowQ.Create(r.Context(), orgID, &claims.UserID, body.Name, body.Description)
	if err != nil {
		writeError(w, "failed to create flow", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, flow)
}

// Get handles GET /api/v1/orgs/:orgId/flows/:flowId
func (h *flowHandler) Get(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	flow, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || flow.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	steps, _ := flowQ.ListSteps(r.Context(), flowID)
	if steps == nil {
		steps = []queries.FlowStep{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"flow": flow, "steps": steps})
}

// Update handles PUT /api/v1/orgs/:orgId/flows/:flowId
func (h *flowHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	existing, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	if err := flowQ.Update(r.Context(), flowID, body.Name, body.Description); err != nil {
		writeError(w, "failed to update flow", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Delete handles DELETE /api/v1/orgs/:orgId/flows/:flowId
func (h *flowHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	existing, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	if err := flowQ.Delete(r.Context(), flowID); err != nil {
		writeError(w, "failed to delete flow", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Steps ─────────────────────────────────────────────────────────────────────

// AddStep handles POST /api/v1/orgs/:orgId/flows/:flowId/steps
func (h *flowHandler) AddStep(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}

	var body struct {
		Position   int    `json:"position"`
		Name       string `json:"name"`
		Product    string `json:"product"`
		TestCaseID string `json:"test_case_id"`
		FolderID   string `json:"folder_id"`
		EnvInputs  any    `json:"env_inputs"`
		EnvOutputs any    `json:"env_outputs"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	var tcID, fID *uuid.UUID
	if body.TestCaseID != "" {
		id, err := uuid.Parse(body.TestCaseID)
		if err != nil {
			writeError(w, "invalid test_case_id", http.StatusBadRequest)
			return
		}
		tcID = &id
	}
	if body.FolderID != "" {
		id, err := uuid.Parse(body.FolderID)
		if err != nil {
			writeError(w, "invalid folder_id", http.StatusBadRequest)
			return
		}
		fID = &id
	}

	product := body.Product
	if product == "" {
		product = "ui"
	}

	envIn, _ := json.Marshal(body.EnvInputs)
	envOut, _ := json.Marshal(body.EnvOutputs)

	flowQ := queries.NewFlowQueries(h.svc.DB)
	existing, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	step, err := flowQ.AddStep(r.Context(), flowID, body.Position, body.Name, product,
		tcID, fID, envIn, envOut)
	if err != nil {
		writeError(w, "failed to add step", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, step)
}

// UpdateStep handles PUT /api/v1/orgs/:orgId/flows/:flowId/steps/:stepId
func (h *flowHandler) UpdateStep(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	stepID, err := uuid.Parse(r.PathValue("stepId"))
	if err != nil {
		writeError(w, "invalid stepId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name       string `json:"name"`
		Product    string `json:"product"`
		TestCaseID string `json:"test_case_id"`
		FolderID   string `json:"folder_id"`
		EnvInputs  any    `json:"env_inputs"`
		EnvOutputs any    `json:"env_outputs"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	var tcID, fID *uuid.UUID
	if body.TestCaseID != "" {
		if id, err := uuid.Parse(body.TestCaseID); err == nil {
			tcID = &id
		}
	}
	if body.FolderID != "" {
		if id, err := uuid.Parse(body.FolderID); err == nil {
			fID = &id
		}
	}

	envIn, _ := json.Marshal(body.EnvInputs)
	envOut, _ := json.Marshal(body.EnvOutputs)

	flowQ := queries.NewFlowQueries(h.svc.DB)
	existing, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	if err := flowQ.UpdateStep(r.Context(), stepID, body.Name, body.Product,
		tcID, fID, envIn, envOut); err != nil {
		writeError(w, "failed to update step", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// DeleteStep handles DELETE /api/v1/orgs/:orgId/flows/:flowId/steps/:stepId
func (h *flowHandler) DeleteStep(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	stepID, err := uuid.Parse(r.PathValue("stepId"))
	if err != nil {
		writeError(w, "invalid stepId", http.StatusBadRequest)
		return
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	existing, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	if err := flowQ.DeleteStep(r.Context(), stepID); err != nil {
		writeError(w, "failed to delete step", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ReorderSteps handles POST /api/v1/orgs/:orgId/flows/:flowId/steps/reorder
func (h *flowHandler) ReorderSteps(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	var body struct {
		StepIDs []string `json:"step_ids"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}
	var ids []uuid.UUID
	for _, s := range body.StepIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			writeError(w, "invalid step_id: "+s, http.StatusBadRequest)
			return
		}
		ids = append(ids, id)
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	existing, err := flowQ.GetByID(r.Context(), flowID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "flow not found", http.StatusNotFound)
		return
	}
	if err := flowQ.ReorderSteps(r.Context(), flowID, ids); err != nil {
		writeError(w, "failed to reorder steps", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Flow Runs ─────────────────────────────────────────────────────────────────

// RunFlow handles POST /api/v1/orgs/:orgId/flows/:flowId/run
func (h *flowHandler) RunFlow(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowID, err := uuid.Parse(r.PathValue("flowId"))
	if err != nil {
		writeError(w, "invalid flowId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())

	flowQ := queries.NewFlowQueries(h.svc.DB)
	flowRun, err := flowQ.CreateRun(r.Context(), flowID, orgID, &claims.UserID)
	if err != nil {
		writeError(w, "failed to create flow run", http.StatusInternalServerError)
		return
	}

	h.svc.Runner.EnqueueFlow(&runner.FlowRunJob{
		FlowRunID: flowRun.ID,
		OrgID:     orgID,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"flow_run_id": flowRun.ID,
		"status":      "queued",
	})
}

// ListRuns handles GET /api/v1/orgs/:orgId/flows/runs
func (h *flowHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	limit := parseIntQ(r, "limit", 20)
	offset := parseIntQ(r, "offset", 0)

	flowQ := queries.NewFlowQueries(h.svc.DB)
	runs, total, err := flowQ.ListRunsByOrg(r.Context(), orgID, limit, offset)
	if err != nil {
		writeError(w, "failed to list flow runs", http.StatusInternalServerError)
		return
	}
	if runs == nil {
		runs = []queries.FlowRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"runs":   runs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetRun handles GET /api/v1/orgs/:orgId/flows/runs/:flowRunId
func (h *flowHandler) GetRun(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	flowRunID, err := uuid.Parse(r.PathValue("flowRunId"))
	if err != nil {
		writeError(w, "invalid flowRunId", http.StatusBadRequest)
		return
	}
	flowQ := queries.NewFlowQueries(h.svc.DB)
	flowRun, err := flowQ.GetRunByID(r.Context(), flowRunID)
	if err != nil {
		writeError(w, "flow run not found", http.StatusNotFound)
		return
	}
	if flowRun.OrgID != orgID {
		writeError(w, "flow run not found", http.StatusNotFound)
		return
	}
	stepRuns, _ := flowQ.ListStepRuns(r.Context(), flowRunID)
	if stepRuns == nil {
		stepRuns = []queries.FlowStepRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"flow_run":  flowRun,
		"step_runs": stepRuns,
	})
}
