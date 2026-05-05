package api

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
)

type gitLabHandler struct {
	svc Services
}

func newGitLabHandler(svc Services) *gitLabHandler {
	return &gitLabHandler{svc: svc}
}

// InitiateOAuth redirects the user to GitLab's OAuth consent page.
// GET /api/v1/orgs/{orgId}/integrations/gitlab/connect
func (h *gitLabHandler) InitiateOAuth(w http.ResponseWriter, r *http.Request) {
	if !h.svc.GitLab.IsConfigured() {
		writeError(w, "GitLab OAuth is not configured on this server", http.StatusNotImplemented)
		return
	}

	orgID := r.PathValue("orgId")
	returnTo := r.URL.Query().Get("return_to")
	if returnTo == "" {
		returnTo = "/settings/integrations"
	}

	authURL := h.svc.GitLab.AuthURL(orgID, returnTo)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// OAuthCallback handles the redirect from GitLab after the user authorizes.
// GET /api/v1/auth/gitlab/callback
func (h *gitLabHandler) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	if code == "" || state == "" {
		writeError(w, "missing code or state", http.StatusBadRequest)
		return
	}

	orgIDStr, returnTo, err := h.svc.GitLab.DecodeState(state)
	if err != nil {
		writeError(w, "invalid state parameter", http.StatusBadRequest)
		return
	}

	orgID, err := uuid.Parse(orgIDStr)
	if err != nil {
		writeError(w, "invalid org id in state", http.StatusBadRequest)
		return
	}

	_, err = h.svc.GitLab.ExchangeCode(r.Context(), code, orgID)
	if err != nil {
		writeError(w, "oauth exchange failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect back to the frontend with a success indicator
	frontendURL := h.svc.Config.FrontendURL
	// Find the org slug to build the full return path
	redirectURL := frontendURL + returnTo + "?gitlab_connected=true"
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// ListIntegrations returns all GitLab integrations for an org.
// GET /api/v1/orgs/{orgId}/integrations/gitlab
func (h *gitLabHandler) ListIntegrations(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid org id", http.StatusBadRequest)
		return
	}

	list, err := h.svc.GitLab.ListIntegrations(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to list integrations", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"integrations": list})
}

// ListRepos returns the GitLab repos accessible to a connected integration.
// GET /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}/repos
func (h *gitLabHandler) ListRepos(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integration id", http.StatusBadRequest)
		return
	}

	repos, err := h.svc.GitLab.ListUserRepos(r.Context(), integrationID)
	if err != nil {
		writeError(w, "failed to list repos: "+err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"repos": repos})
}

// UpdateIntegration saves the repo, branch, and subproject settings.
// PUT /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}
func (h *gitLabHandler) UpdateIntegration(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integration id", http.StatusBadRequest)
		return
	}

	var body struct {
		SubProjectID string `json:"subproject_id"`
		RepoID       int64  `json:"repo_id"`
		RepoName     string `json:"repo_name"`
		RepoURL      string `json:"repo_url"`
		Branch       string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.Branch == "" {
		body.Branch = "main"
	}

	var subprojectID *uuid.UUID
	if body.SubProjectID != "" {
		id, err := uuid.Parse(body.SubProjectID)
		if err != nil {
			writeError(w, "invalid subproject_id", http.StatusBadRequest)
			return
		}
		subprojectID = &id
	}

	if err := h.svc.GitLab.UpdateSettings(r.Context(), integrationID, subprojectID, body.RepoID, body.RepoName, body.RepoURL, body.Branch); err != nil {
		writeError(w, "update failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	integ, err := h.svc.GitLab.GetIntegration(r.Context(), integrationID)
	if err != nil {
		writeError(w, "integration not found", http.StatusNotFound)
		return
	}

	writeJSON(w, http.StatusOK, integ)
}

// SyncIntegration pulls spec files from the configured repo and imports them.
// POST /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}/sync
func (h *gitLabHandler) SyncIntegration(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integration id", http.StatusBadRequest)
		return
	}

	result, err := h.svc.GitLab.SyncRepo(r.Context(), integrationID)
	if err != nil {
		writeError(w, "sync failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// DeleteIntegration disconnects a GitLab repo from an org.
// DELETE /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}
func (h *gitLabHandler) DeleteIntegration(w http.ResponseWriter, r *http.Request) {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integration id", http.StatusBadRequest)
		return
	}

	if err := h.svc.GitLab.DeleteIntegration(r.Context(), integrationID); err != nil {
		writeError(w, "delete failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
