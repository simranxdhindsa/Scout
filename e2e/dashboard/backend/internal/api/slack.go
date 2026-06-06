package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/google/uuid"
)

type slackHandler struct {
	svc Services
}

func newSlackHandler(svc Services) *slackHandler {
	return &slackHandler{svc: svc}
}

type SlackSettings struct {
	WebhookURL      string `json:"webhook_url"`
	NotifyOnFailure bool   `json:"notify_on_failure"`
	NotifyOnSuccess bool   `json:"notify_on_success"`
}

// GetSettings handles GET /api/v1/orgs/:orgId/settings/slack
func (h *slackHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	var s SlackSettings
	err = h.svc.DB.QueryRow(r.Context(), `
		SELECT COALESCE(slack_webhook_url,''),
		       COALESCE(slack_notify_on_failure, TRUE),
		       COALESCE(slack_notify_on_success, FALSE)
		FROM organizations WHERE id = $1`, orgID).
		Scan(&s.WebhookURL, &s.NotifyOnFailure, &s.NotifyOnSuccess)
	if err != nil {
		writeError(w, "org not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// UpdateSettings handles PUT /api/v1/orgs/:orgId/settings/slack
func (h *slackHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	_ = auth.ClaimsFromContext(r.Context()) // auth gate already applied

	var body SlackSettings
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}
	_, err = h.svc.DB.Exec(r.Context(), `
		UPDATE organizations
		SET slack_webhook_url = $2,
		    slack_notify_on_failure = $3,
		    slack_notify_on_success = $4
		WHERE id = $1`, orgID, body.WebhookURL, body.NotifyOnFailure, body.NotifyOnSuccess)
	if err != nil {
		writeError(w, "failed to update slack settings", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
