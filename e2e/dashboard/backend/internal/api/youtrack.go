package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/apyhub/scout/internal/youtrack"
	"github.com/google/uuid"
)

type youtrackHandler struct {
	svc Services
}

func newYouTrackHandler(svc Services) *youtrackHandler {
	return &youtrackHandler{svc: svc}
}

// ── Integration ───────────────────────────────────────────────────────────────

// Connect handles POST /api/v1/orgs/:orgId/integrations/youtrack
// Validates the token then upserts the integration record.
func (h *youtrackHandler) Connect(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		BaseURL   string `json:"base_url"`
		Token     string `json:"token"`
		ProjectID string `json:"project_id"`
		BoardID   string `json:"board_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.BaseURL == "" || body.Token == "" || body.ProjectID == "" {
		writeError(w, "base_url, token, and project_id are required", http.StatusBadRequest)
		return
	}

	// Validate token before saving
	client := youtrack.NewClient(body.BaseURL, body.Token, body.ProjectID, body.BoardID)
	if err := client.TestConnection(r.Context()); err != nil {
		writeError(w, "YouTrack connection failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	integration, err := h.svc.YouTrack.Connect(r.Context(), orgID, claims.UserID,
		body.BaseURL, body.Token, body.ProjectID, body.BoardID)
	if err != nil {
		writeError(w, "failed to save integration", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, integration)
}

// GetStatus handles GET /api/v1/orgs/:orgId/integrations/youtrack
func (h *youtrackHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())

	integration, err := h.svc.YouTrack.GetForUser(r.Context(), orgID, claims.UserID)
	if err != nil {
		// Not found = not connected
		writeJSON(w, http.StatusOK, map[string]any{"connected": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connected":   integration.Connected,
		"integration": integration,
	})
}

// Disconnect handles DELETE /api/v1/orgs/:orgId/integrations/youtrack/:integrationId
func (h *youtrackHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integrationId", http.StatusBadRequest)
		return
	}
	// Verify org ownership
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	integration, err := h.svc.YouTrack.GetByID(r.Context(), integrationID)
	if err != nil || integration.OrgID != orgID {
		writeError(w, "integration not found", http.StatusNotFound)
		return
	}
	if err := h.svc.YouTrack.Disconnect(r.Context(), integrationID); err != nil {
		writeError(w, "failed to disconnect", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

// ── Boards ────────────────────────────────────────────────────────────────────

// GetBoards handles GET /api/v1/orgs/:orgId/integrations/youtrack/:integrationId/boards
// Returns available agile boards to let users pick a board ID.
func (h *youtrackHandler) GetBoards(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integrationId", http.StatusBadRequest)
		return
	}
	client, err := h.svc.YouTrack.GetClient(r.Context(), integrationID)
	if err != nil {
		writeError(w, "integration not found", http.StatusNotFound)
		return
	}
	boards, err := client.GetBoards(r.Context())
	if err != nil {
		writeError(w, "failed to fetch boards: "+err.Error(), http.StatusBadGateway)
		return
	}
	if boards == nil {
		boards = []youtrack.Board{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"boards": boards})
}

// ── Sprints ───────────────────────────────────────────────────────────────────

// GetSprints handles GET /api/v1/orgs/:orgId/integrations/youtrack/:integrationId/sprints
func (h *youtrackHandler) GetSprints(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integrationId", http.StatusBadRequest)
		return
	}
	client, err := h.svc.YouTrack.GetClient(r.Context(), integrationID)
	if err != nil {
		writeError(w, "integration not found", http.StatusNotFound)
		return
	}
	sprints, err := client.GetSprints(r.Context())
	if err != nil {
		writeError(w, "failed to fetch sprints: "+err.Error(), http.StatusBadGateway)
		return
	}
	if sprints == nil {
		sprints = []youtrack.Sprint{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sprints": sprints})
}

// GetSprintIssues handles GET /api/v1/orgs/:orgId/integrations/youtrack/:integrationId/sprints/:sprintId/issues
func (h *youtrackHandler) GetSprintIssues(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integrationId", http.StatusBadRequest)
		return
	}
	sprintID := r.PathValue("sprintId")
	if sprintID == "" {
		writeError(w, "sprintId required", http.StatusBadRequest)
		return
	}

	client, err := h.svc.YouTrack.GetClient(r.Context(), integrationID)
	if err != nil {
		writeError(w, "integration not found", http.StatusNotFound)
		return
	}
	issues, err := client.GetSprintIssues(r.Context(), sprintID)
	if err != nil {
		writeError(w, "failed to fetch issues: "+err.Error(), http.StatusBadGateway)
		return
	}
	if issues == nil {
		issues = []youtrack.Issue{}
	}

	// Annotate each issue with its mapping (test case IDs)
	ticketIDs := make([]string, len(issues))
	for i, iss := range issues {
		ticketIDs[i] = iss.IDReadable
		if ticketIDs[i] == "" {
			ticketIDs[i] = iss.ID
		}
	}
	mappedIDs, err := h.svc.YouTrack.GetMappedTestCaseIDs(r.Context(), orgID, ticketIDs)
	if err != nil {
		log.Printf("[youtrack] GetMappedTestCaseIDs org=%s: %v", orgID, err)
	}
	mappedSet := map[uuid.UUID]bool{}
	for _, id := range mappedIDs {
		mappedSet[id] = true
	}

	// Load all mappings for the org to annotate per ticket
	mappings, err := h.svc.YouTrack.ListMappings(r.Context(), orgID)
	if err != nil {
		log.Printf("[youtrack] ListMappings org=%s: %v", orgID, err)
	}
	mappingsByTicket := map[string][]youtrack.TicketMapping{}
	for _, m := range mappings {
		mappingsByTicket[m.TicketID] = append(mappingsByTicket[m.TicketID], m)
	}

	type issueWithCoverage struct {
		youtrack.Issue
		TicketKey string                   `json:"ticket_key"`
		Status    string                   `json:"status"`
		Priority  string                   `json:"priority"`
		Subsystem string                   `json:"subsystem"`
		Mappings  []youtrack.TicketMapping `json:"mappings"`
	}
	out := make([]issueWithCoverage, len(issues))
	for i, iss := range issues {
		key := iss.IDReadable
		if key == "" {
			key = iss.ID
		}
		out[i] = issueWithCoverage{
			Issue:     iss,
			TicketKey: key,
			Status:    youtrack.GetStatus(iss),
			Priority:  youtrack.GetPriority(iss),
			Subsystem: youtrack.GetSubsystem(iss),
			Mappings:  mappingsByTicket[key],
		}
		if out[i].Mappings == nil {
			out[i].Mappings = []youtrack.TicketMapping{}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"issues": out})
}

// RunSprint handles POST /api/v1/orgs/:orgId/integrations/youtrack/:integrationId/sprints/:sprintId/run
// Creates a Scout test run for all test cases mapped to this sprint's tickets.
func (h *youtrackHandler) RunSprint(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integrationId", http.StatusBadRequest)
		return
	}
	sprintID := r.PathValue("sprintId")
	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Label string `json:"label"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	client, err := h.svc.YouTrack.GetClient(r.Context(), integrationID)
	if err != nil {
		writeError(w, "integration not found", http.StatusNotFound)
		return
	}

	// Fetch sprint issues to get ticket IDs
	issues, err := client.GetSprintIssues(r.Context(), sprintID)
	if err != nil {
		writeError(w, "failed to fetch sprint issues: "+err.Error(), http.StatusBadGateway)
		return
	}
	ticketIDs := make([]string, 0, len(issues))
	for _, iss := range issues {
		key := iss.IDReadable
		if key == "" {
			key = iss.ID
		}
		ticketIDs = append(ticketIDs, key)
	}

	testCaseIDs, err := h.svc.YouTrack.GetMappedTestCaseIDs(r.Context(), orgID, ticketIDs)
	if err != nil || len(testCaseIDs) == 0 {
		writeError(w, "no test cases mapped to this sprint's tickets", http.StatusUnprocessableEntity)
		return
	}

	label := body.Label
	if label == "" {
		label = "Sprint run"
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	run, err := runQ.Create(r.Context(), orgID, nil, &claims.UserID, label, nil)
	if err != nil {
		writeError(w, "failed to create run", http.StatusInternalServerError)
		return
	}
	for _, tcID := range testCaseIDs {
		id := tcID
		_, _ = runQ.CreateItem(r.Context(), run.ID, &id, nil)
	}
	h.svc.Runner.Enqueue(&runner.RunJob{
		RunID: run.ID,
		OrgID: orgID,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"run_id": run.ID,
		"status": "queued",
		"tests":  len(testCaseIDs),
	})
}

// ── Ticket Mappings ───────────────────────────────────────────────────────────

// ListMappings handles GET /api/v1/orgs/:orgId/youtrack/mappings
func (h *youtrackHandler) ListMappings(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	mappings, err := h.svc.YouTrack.ListMappings(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to list mappings", http.StatusInternalServerError)
		return
	}
	if mappings == nil {
		mappings = []youtrack.TicketMapping{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"mappings": mappings})
}

// CreateMapping handles POST /api/v1/orgs/:orgId/youtrack/mappings
func (h *youtrackHandler) CreateMapping(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	var body struct {
		TicketID    string `json:"ticket_id"`
		TicketTitle string `json:"ticket_title"`
		TestCaseID  string `json:"test_case_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TicketID == "" || body.TestCaseID == "" {
		writeError(w, "ticket_id and test_case_id are required", http.StatusBadRequest)
		return
	}
	testCaseID, err := uuid.Parse(body.TestCaseID)
	if err != nil {
		writeError(w, "invalid test_case_id", http.StatusBadRequest)
		return
	}
	mapping, err := h.svc.YouTrack.CreateMapping(r.Context(), orgID, body.TicketID, body.TicketTitle, testCaseID)
	if err != nil {
		writeError(w, "failed to create mapping", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, mapping)
}

// DeleteMapping handles DELETE /api/v1/orgs/:orgId/youtrack/mappings/:mappingId
func (h *youtrackHandler) DeleteMapping(w http.ResponseWriter, r *http.Request) {
	mappingID, err := uuid.Parse(r.PathValue("mappingId"))
	if err != nil {
		writeError(w, "invalid mappingId", http.StatusBadRequest)
		return
	}
	if err := h.svc.YouTrack.DeleteMapping(r.Context(), mappingID); err != nil {
		writeError(w, "failed to delete mapping", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
