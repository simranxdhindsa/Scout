package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/google/uuid"
)

type runHandler struct {
	svc Services
}

func newRunHandler(svc Services) *runHandler {
	return &runHandler{svc: svc}
}

// Start handles POST /api/v1/orgs/:orgId/runs
func (h *runHandler) Start(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		TargetType    string            `json:"target_type"`    // "test_case" | "folder" | "pipeline"
		TargetIDs     []string          `json:"target_ids"`
		EnvironmentID string            `json:"environment_id"`
		Credentials   map[string]string `json:"credentials"`    // {email, password} — in-memory only
		Label         string            `json:"label"`
		Headed        bool              `json:"headed"`         // when true, Playwright runs with a visible browser
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}
	if body.TargetType == "" || len(body.TargetIDs) == 0 {
		writeError(w, "target_type and target_ids are required", http.StatusBadRequest)
		return
	}

	// Parse environment ID
	var envID *uuid.UUID
	if body.EnvironmentID != "" {
		id, err := uuid.Parse(body.EnvironmentID)
		if err != nil {
			writeError(w, "invalid environment_id", http.StatusBadRequest)
			return
		}
		envID = &id
	}

	// Marshal credentials for temporary storage
	var credsJSON []byte
	if len(body.Credentials) > 0 {
		credsJSON, _ = json.Marshal(body.Credentials)
	}

	// Generate label if not provided
	label := body.Label
	if label == "" {
		label = body.TargetType + " run"
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	run, err := runQ.Create(r.Context(), orgID, envID, &claims.UserID, label, credsJSON)
	if err != nil {
		writeError(w, "failed to create run", http.StatusInternalServerError)
		return
	}

	// Resolve target IDs → test case IDs and create run items
	testCaseIDs, err := h.resolveTargets(r, body.TargetType, body.TargetIDs)
	if err != nil {
		writeError(w, "failed to resolve targets: "+err.Error(), http.StatusBadRequest)
		return
	}

	for _, tcID := range testCaseIDs {
		id := tcID
		if _, err := runQ.CreateItem(r.Context(), run.ID, &id, nil); err != nil {
			log.Printf("[runs] create item for test %s in run %s: %v", id, run.ID, err)
		}
	}

	// Enqueue the run
	h.svc.Runner.Enqueue(&runner.RunJob{
		RunID:  run.ID,
		OrgID:  orgID,
		Headed: body.Headed,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"run_id": run.ID,
		"status": "queued",
		"label":  run.Label,
	})
}

// List handles GET /api/v1/orgs/:orgId/runs
func (h *runHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	status := r.URL.Query().Get("status")
	limit := parseIntQ(r, "limit", 20)
	offset := parseIntQ(r, "offset", 0)

	runQ := queries.NewRunQueries(h.svc.DB)
	runs, total, err := runQ.List(r.Context(), orgID, status, limit, offset)
	if err != nil {
		writeError(w, "failed to list runs", http.StatusInternalServerError)
		return
	}
	if runs == nil {
		runs = []queries.TestRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"runs":   runs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
		"active": h.svc.Runner.ActiveCount(),
	})
}

// Get handles GET /api/v1/orgs/:orgId/runs/:runId
func (h *runHandler) Get(w http.ResponseWriter, r *http.Request) {
	runID, err := uuid.Parse(r.PathValue("runId"))
	if err != nil {
		writeError(w, "invalid runId", http.StatusBadRequest)
		return
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	run, err := runQ.GetByID(r.Context(), runID)
	if err != nil {
		writeError(w, "run not found", http.StatusNotFound)
		return
	}

	items, itemsErr := runQ.ListItems(r.Context(), runID)
	if itemsErr != nil {
		log.Printf("[runs] list items for run %s: %v", runID, itemsErr)
	}
	if items == nil {
		items = []queries.RunItem{}
	}

	report, _ := runQ.GetReport(r.Context(), runID)

	attachments, _ := runQ.ListAttachments(r.Context(), runID)
	if attachments == nil {
		attachments = []queries.RunAttachment{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run":         run,
		"items":       items,
		"report":      report,
		"attachments": attachments,
	})
}

// Stop handles DELETE /api/v1/orgs/:orgId/runs/:runId
func (h *runHandler) Stop(w http.ResponseWriter, r *http.Request) {
	runID, err := uuid.Parse(r.PathValue("runId"))
	if err != nil {
		writeError(w, "invalid runId", http.StatusBadRequest)
		return
	}

	stopped := h.svc.Runner.Stop(runID)
	if !stopped {
		writeError(w, "run is not active", http.StatusNotFound)
		return
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	_ = runQ.UpdateStatus(r.Context(), runID, "stopped")

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

// Stream handles GET /api/v1/orgs/:orgId/runs/:runId/stream (WebSocket)
func (h *runHandler) Stream(w http.ResponseWriter, r *http.Request) {
	runID, err := uuid.Parse(r.PathValue("runId"))
	if err != nil {
		log.Printf("[stream] handler hit with invalid runId path=%s err=%v", r.URL.Path, err)
		http.Error(w, "invalid runId", http.StatusBadRequest)
		return
	}

	// Log enough headers to debug proxy/middleware issues without dumping the
	// JWT. WS upgrade is failing if Connection/Upgrade don't arrive intact.
	log.Printf("[stream] handler hit run=%s remote=%s xff=%q upgrade=%q connection=%q sec-ws-key=%q sec-ws-version=%q",
		runID,
		r.RemoteAddr,
		r.Header.Get("X-Forwarded-For"),
		r.Header.Get("Upgrade"),
		r.Header.Get("Connection"),
		r.Header.Get("Sec-WebSocket-Key"),
		r.Header.Get("Sec-WebSocket-Version"),
	)

	// For WebSocket, JWT comes as query param ?token=...
	token := r.URL.Query().Get("token")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}

	h.svc.Runner.Streams().HandleWS(w, r, runID)
	log.Printf("[stream] handler returned for run=%s", runID)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// resolveTargets converts target type + IDs to a flat list of test case UUIDs.
func (h *runHandler) resolveTargets(r *http.Request, targetType string, targetIDs []string) ([]uuid.UUID, error) {
	var testCaseIDs []uuid.UUID

	folderQ := queries.NewFolderQueries(h.svc.DB)
	testQ := queries.NewTestQueries(h.svc.DB)

	for _, idStr := range targetIDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			continue
		}

		switch targetType {
		case "test_case":
			testCaseIDs = append(testCaseIDs, id)

		case "folder":
			// Get all folder IDs in the subtree
			folderIDs, err := folderQ.GetSubtreeIDs(r.Context(), id)
			if err != nil {
				continue
			}
			// Get all test cases in those folders
			for _, fid := range folderIDs {
				tests, err := testQ.ListByFolder(r.Context(), fid)
				if err != nil {
					continue
				}
				for _, t := range tests {
					testCaseIDs = append(testCaseIDs, t.ID)
				}
			}
		}
	}

	return testCaseIDs, nil
}

func parseIntQ(r *http.Request, key string, fallback int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return fallback
	}
	return n
}
