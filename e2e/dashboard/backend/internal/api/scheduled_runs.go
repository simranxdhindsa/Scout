package api

import (
	"net/http"
	"time"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/scheduler"
	"github.com/google/uuid"
)

type scheduledRunHandler struct {
	svc Services
}

func newScheduledRunHandler(svc Services) *scheduledRunHandler {
	return &scheduledRunHandler{svc: svc}
}

type scheduledRunBody struct {
	Label       string      `json:"label"`
	CronExpr    string      `json:"cron_expr"`
	EnvID       string      `json:"env_id"`
	FolderID    string      `json:"folder_id"`
	TestCaseIDs []string    `json:"test_case_ids"`
	Product     string      `json:"product"`
	Enabled     *bool       `json:"enabled"`
}

func parseScheduledRunBody(body scheduledRunBody) (
	label, cronExpr, product string,
	envID, folderID *uuid.UUID,
	testCaseIDs []uuid.UUID,
	nextRunAt *time.Time,
	valErr string,
) {
	label = body.Label
	if label == "" {
		label = "Scheduled run"
	}
	cronExpr = body.CronExpr
	if cronExpr == "" {
		cronExpr = "0 9 * * 1" // every Monday at 9am
	}
	product = body.Product
	if product == "" {
		product = "ui"
	}
	if body.EnvID != "" {
		if id, err := uuid.Parse(body.EnvID); err == nil {
			envID = &id
		}
	}
	if body.FolderID != "" {
		if id, err := uuid.Parse(body.FolderID); err == nil {
			folderID = &id
		}
	}
	for _, s := range body.TestCaseIDs {
		if id, err := uuid.Parse(s); err == nil {
			testCaseIDs = append(testCaseIDs, id)
		}
	}
	nextRunAt = scheduler.NextAfter(cronExpr, time.Now())
	return
}

// List handles GET /api/v1/orgs/:orgId/scheduled-runs
func (h *scheduledRunHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	sq := queries.NewScheduledRunQueries(h.svc.DB)
	runs, err := sq.List(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to list scheduled runs", http.StatusInternalServerError)
		return
	}
	if runs == nil {
		runs = []queries.ScheduledRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"scheduled_runs": runs})
}

// Create handles POST /api/v1/orgs/:orgId/scheduled-runs
func (h *scheduledRunHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	var body scheduledRunBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}
	label, cronExpr, product, envID, folderID, testCaseIDs, nextRunAt, _ := parseScheduledRunBody(body)
	sq := queries.NewScheduledRunQueries(h.svc.DB)
	run, err := sq.Create(r.Context(), orgID, &claims.UserID, label, cronExpr, product, envID, folderID, testCaseIDs, nextRunAt)
	if err != nil {
		writeError(w, "failed to create scheduled run", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, run)
}

// Update handles PUT /api/v1/orgs/:orgId/scheduled-runs/:schedId
func (h *scheduledRunHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	schedID, err := uuid.Parse(r.PathValue("schedId"))
	if err != nil {
		writeError(w, "invalid schedId", http.StatusBadRequest)
		return
	}
	var body scheduledRunBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}
	sq := queries.NewScheduledRunQueries(h.svc.DB)
	existing, err := sq.GetByID(r.Context(), schedID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "scheduled run not found", http.StatusNotFound)
		return
	}
	label, cronExpr, product, envID, folderID, testCaseIDs, nextRunAt, _ := parseScheduledRunBody(body)
	enabled := existing.Enabled
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	if err := sq.Update(r.Context(), schedID, label, cronExpr, product, envID, folderID, testCaseIDs, enabled, nextRunAt); err != nil {
		writeError(w, "failed to update scheduled run", http.StatusInternalServerError)
		return
	}
	updated, _ := sq.GetByID(r.Context(), schedID)
	writeJSON(w, http.StatusOK, updated)
}

// Delete handles DELETE /api/v1/orgs/:orgId/scheduled-runs/:schedId
func (h *scheduledRunHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	schedID, err := uuid.Parse(r.PathValue("schedId"))
	if err != nil {
		writeError(w, "invalid schedId", http.StatusBadRequest)
		return
	}
	sq := queries.NewScheduledRunQueries(h.svc.DB)
	existing, err := sq.GetByID(r.Context(), schedID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "scheduled run not found", http.StatusNotFound)
		return
	}
	if err := sq.Delete(r.Context(), schedID); err != nil {
		writeError(w, "failed to delete scheduled run", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ToggleEnabled handles POST /api/v1/orgs/:orgId/scheduled-runs/:schedId/toggle
func (h *scheduledRunHandler) ToggleEnabled(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	schedID, err := uuid.Parse(r.PathValue("schedId"))
	if err != nil {
		writeError(w, "invalid schedId", http.StatusBadRequest)
		return
	}
	sq := queries.NewScheduledRunQueries(h.svc.DB)
	existing, err := sq.GetByID(r.Context(), schedID)
	if err != nil || existing.OrgID != orgID {
		writeError(w, "scheduled run not found", http.StatusNotFound)
		return
	}
	if err := sq.SetEnabled(r.Context(), schedID, !existing.Enabled); err != nil {
		writeError(w, "failed to toggle scheduled run", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": !existing.Enabled})
}
