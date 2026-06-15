package api

import (
	"log"
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

type reportHandler struct {
	svc Services
}

func newReportHandler(svc Services) *reportHandler {
	return &reportHandler{svc: svc}
}

// Trend handles GET /api/v1/orgs/:orgId/reports
// Returns daily pass/fail counts for the last N days (default 30).
func (h *reportHandler) Trend(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	days := parseIntQ(r, "days", 30)
	if days < 1 || days > 365 {
		days = 30
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	trend, err := runQ.GetTrend(r.Context(), orgID, days)
	if err != nil {
		log.Printf("[reports] trend query failed org=%s days=%d: %v", orgID, days, err)
		writeError(w, "failed to get trend data", http.StatusInternalServerError)
		return
	}
	if trend == nil {
		trend = []queries.TrendData{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"trend": trend,
		"days":  days,
	})
}

// Stats handles GET /api/v1/orgs/:orgId/reports/stats
// Returns aggregate statistics for an org.
func (h *reportHandler) Stats(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var stats struct {
		TotalRuns     int     `json:"total_runs"`
		TotalPassed   int     `json:"total_passed"`
		TotalFailed   int     `json:"total_failed"`
		TotalTests    int     `json:"total_tests"`
		AvgPassRate   float64 `json:"avg_pass_rate"`
		ActiveRuns    int     `json:"active_runs"`
		QueuedRuns    int     `json:"queued_runs"`
	}

	_ = h.svc.DB.QueryRow(r.Context(), `
		SELECT
		  COUNT(DISTINCT tr.id)                              AS total_runs,
		  COALESCE(SUM(rr.passed), 0)                       AS total_passed,
		  COALESCE(SUM(rr.failed), 0)                       AS total_failed,
		  COALESCE(SUM(rr.total), 0)                        AS total_tests,
		  COALESCE(AVG(CASE WHEN rr.total > 0
		    THEN rr.passed::FLOAT / rr.total * 100 END), 0) AS avg_pass_rate
		FROM test_runs tr
		LEFT JOIN run_reports rr ON rr.run_id = tr.id
		WHERE tr.org_id = $1 AND tr.status IN ('done','failed')
	`, orgID).Scan(
		&stats.TotalRuns, &stats.TotalPassed, &stats.TotalFailed,
		&stats.TotalTests, &stats.AvgPassRate,
	)

	_ = h.svc.DB.QueryRow(r.Context(), `
		SELECT
		  COUNT(*) FILTER (WHERE status = 'running') AS active,
		  COUNT(*) FILTER (WHERE status = 'queued')  AS queued
		FROM test_runs WHERE org_id = $1
	`, orgID).Scan(&stats.ActiveRuns, &stats.QueuedRuns)

	stats.ActiveRuns += h.svc.Runner.ActiveCount()

	writeJSON(w, http.StatusOK, stats)
}

// Get handles GET /api/v1/runs/:runId/report
func (h *reportHandler) Get(w http.ResponseWriter, r *http.Request) {
	runID, err := uuid.Parse(r.PathValue("runId"))
	if err != nil {
		writeError(w, "invalid runId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForRun(r.Context(), h.svc.DB, runID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	report, err := runQ.GetReport(r.Context(), runID)
	if err != nil {
		writeError(w, "report not found", http.StatusNotFound)
		return
	}

	items, _ := runQ.ListItems(r.Context(), runID)
	if items == nil {
		items = []queries.RunItem{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"report": report,
		"items":  items,
	})
}

// Attachments handles GET /api/v1/runs/:runId/attachments
func (h *reportHandler) Attachments(w http.ResponseWriter, r *http.Request) {
	runID, err := uuid.Parse(r.PathValue("runId"))
	if err != nil {
		writeError(w, "invalid runId", http.StatusBadRequest)
		return
	}

	orgIDAt, okAt := orgIDForRun(r.Context(), h.svc.DB, runID)
	if !okAt {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claimsAt := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgIDAt, claimsAt.UserID) {
		return
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	attachments, err := runQ.ListAttachments(r.Context(), runID)
	if err != nil {
		writeError(w, "failed to list attachments", http.StatusInternalServerError)
		return
	}
	if attachments == nil {
		attachments = []queries.RunAttachment{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"attachments": attachments})
}
