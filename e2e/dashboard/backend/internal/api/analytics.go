package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

type analyticsHandler struct {
	svc Services
}

func newAnalyticsHandler(svc Services) *analyticsHandler {
	return &analyticsHandler{svc: svc}
}

// Overview handles GET /api/v1/orgs/:orgId/analytics/overview
func (h *analyticsHandler) Overview(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	aq := queries.NewAnalyticsQueries(h.svc.DB)
	ov, err := aq.GetOverview(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to get overview", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ov)
}

// FlakyTests handles GET /api/v1/orgs/:orgId/analytics/flaky
func (h *analyticsHandler) FlakyTests(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	limit := parseIntQ(r, "limit", 20)
	if limit < 1 || limit > 100 {
		limit = 20
	}

	aq := queries.NewAnalyticsQueries(h.svc.DB)
	flaky, err := aq.GetFlakyTests(r.Context(), orgID, limit)
	if err != nil {
		writeError(w, "failed to get flaky tests", http.StatusInternalServerError)
		return
	}
	if flaky == nil {
		flaky = []queries.FlakyTest{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"flaky_tests": flaky})
}

// SlowTests handles GET /api/v1/orgs/:orgId/analytics/slow
func (h *analyticsHandler) SlowTests(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	limit := parseIntQ(r, "limit", 20)
	if limit < 1 || limit > 100 {
		limit = 20
	}

	aq := queries.NewAnalyticsQueries(h.svc.DB)
	slow, err := aq.GetSlowTests(r.Context(), orgID, limit)
	if err != nil {
		writeError(w, "failed to get slow tests", http.StatusInternalServerError)
		return
	}
	if slow == nil {
		slow = []queries.SlowTest{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"slow_tests": slow})
}

// TestHistory handles GET /api/v1/orgs/:orgId/analytics/tests/:testCaseId/history
func (h *analyticsHandler) TestHistory(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	testCaseID, err := uuid.Parse(r.PathValue("testCaseId"))
	if err != nil {
		writeError(w, "invalid testCaseId", http.StatusBadRequest)
		return
	}

	limit := parseIntQ(r, "limit", 30)
	if limit < 1 || limit > 100 {
		limit = 30
	}

	aq := queries.NewAnalyticsQueries(h.svc.DB)
	history, err := aq.GetTestHistory(r.Context(), orgID, testCaseID, limit)
	if err != nil {
		writeError(w, "failed to get test history", http.StatusInternalServerError)
		return
	}
	if history == nil {
		history = []queries.TestRunHistory{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": history})
}
