package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/gitlab"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type gitLabHandler struct {
	svc Services
}

func newGitLabHandler(svc Services) *gitLabHandler {
	return &gitLabHandler{svc: svc}
}

// ConnectURL returns the GitLab OAuth consent URL for the caller. The SPA
// then navigates to that URL. Authed so the user identity is bound into the
// state before the browser leaves for GitLab.
// GET /api/v1/orgs/{orgId}/integrations/gitlab/connect-url
func (h *gitLabHandler) ConnectURL(w http.ResponseWriter, r *http.Request) {
	if !h.svc.GitLab.IsConfigured() {
		log.Printf("[gitlab] IsConfigured=false — client_id or client_secret is empty, aborting")
		writeError(w, "GitLab OAuth is not configured on this server", http.StatusNotImplemented)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	orgID := r.PathValue("orgId")
	returnTo := r.URL.Query().Get("return_to")
	if returnTo == "" {
		returnTo = "/dashboard/settings/integrations"
	}

	url := h.svc.GitLab.AuthURL(orgID, claims.UserID.String(), returnTo)
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
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

	orgIDStr, userIDStr, returnTo, err := h.svc.GitLab.DecodeState(state)
	if err != nil {
		writeError(w, "invalid state parameter", http.StatusBadRequest)
		return
	}

	orgID, err := uuid.Parse(orgIDStr)
	if err != nil {
		writeError(w, "invalid org id in state", http.StatusBadRequest)
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		writeError(w, "invalid user id in state", http.StatusBadRequest)
		return
	}

	_, err = h.svc.GitLab.ExchangeCode(r.Context(), code, orgID, userID)
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

// ListIntegrations returns the caller's GitLab integrations inside the org.
// GET /api/v1/orgs/{orgId}/integrations/gitlab
func (h *gitLabHandler) ListIntegrations(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid org id", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	list, err := h.svc.GitLab.ListIntegrations(r.Context(), orgID, claims.UserID)
	if err != nil {
		writeError(w, "failed to list integrations", http.StatusInternalServerError)
		return
	}
	if list == nil {
		list = []gitlab.Integration{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"integrations": list})
}

// requireOwnedIntegration parses {integrationId} and verifies the caller owns it.
// On failure it writes the error response and returns nil.
func (h *gitLabHandler) requireOwnedIntegration(w http.ResponseWriter, r *http.Request) *uuid.UUID {
	integrationID, err := uuid.Parse(r.PathValue("integrationId"))
	if err != nil {
		writeError(w, "invalid integration id", http.StatusBadRequest)
		return nil
	}
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return nil
	}
	if _, err := h.svc.GitLab.GetOwnedIntegration(r.Context(), integrationID, claims.UserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, "integration not found", http.StatusNotFound)
		} else {
			writeError(w, "integration lookup failed", http.StatusInternalServerError)
		}
		return nil
	}
	return &integrationID
}

// ListRepos returns the GitLab repos accessible to a connected integration.
// GET /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}/repos
func (h *gitLabHandler) ListRepos(w http.ResponseWriter, r *http.Request) {
	integrationID := h.requireOwnedIntegration(w, r)
	if integrationID == nil {
		return
	}

	repos, err := h.svc.GitLab.ListUserRepos(r.Context(), *integrationID)
	if err != nil {
		writeError(w, "failed to list repos: "+err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"repos": repos})
}

// UpdateIntegration saves the repo, branch, and subproject settings.
// PUT /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}
func (h *gitLabHandler) UpdateIntegration(w http.ResponseWriter, r *http.Request) {
	integrationIDPtr := h.requireOwnedIntegration(w, r)
	if integrationIDPtr == nil {
		return
	}
	integrationID := *integrationIDPtr

	var body struct {
		SubProjectID string `json:"subproject_id"`
		RepoID       int64  `json:"repo_id"`
		RepoName     string `json:"repo_name"`
		RepoURL      string `json:"repo_url"`
		Branch       string `json:"branch"`
		RepoPath     string `json:"repo_path"`
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

	if err := h.svc.GitLab.UpdateSettings(r.Context(), integrationID, subprojectID, body.RepoID, body.RepoName, body.RepoURL, body.Branch, body.RepoPath); err != nil {

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

// ListDirs returns all directories in a repo for the folder picker.
// GET /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}/dirs?repo_id=...&branch=...
// repo_id and branch are optional — fall back to whatever is saved on the integration.
func (h *gitLabHandler) ListDirs(w http.ResponseWriter, r *http.Request) {
	integrationID := h.requireOwnedIntegration(w, r)
	if integrationID == nil {
		return
	}

	var repoID int64
	if v := r.URL.Query().Get("repo_id"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeError(w, "invalid repo_id", http.StatusBadRequest)
			return
		}
		repoID = parsed
	}
	branch := r.URL.Query().Get("branch")

	dirs, err := h.svc.GitLab.ListRepoDirs(r.Context(), *integrationID, repoID, branch)
	if err != nil {
		writeError(w, "failed to list dirs: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if dirs == nil {
		dirs = []string{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"dirs": dirs})
}

// SyncProduct pulls spec files using the caller's integration for the
// product's linked repo, into the product's configured sub_project.
// POST /api/v1/orgs/{orgId}/products/{productId}/gitlab/sync
func (h *gitLabHandler) SyncProduct(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid org id", http.StatusBadRequest)
		return
	}
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid product id", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	result, err := h.svc.GitLab.SyncProductRepo(r.Context(), orgID, productID, claims.UserID)
	if err != nil {
		writeError(w, "sync failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// DeleteIntegration disconnects a caller-owned GitLab integration.
// DELETE /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}
func (h *gitLabHandler) DeleteIntegration(w http.ResponseWriter, r *http.Request) {
	integrationID := h.requireOwnedIntegration(w, r)
	if integrationID == nil {
		return
	}

	if err := h.svc.GitLab.DeleteIntegration(r.Context(), *integrationID); err != nil {
		writeError(w, "delete failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
