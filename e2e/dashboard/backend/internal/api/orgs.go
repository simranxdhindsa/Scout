package api

import (
	"encoding/json"
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

// ── Auth handler ──────────────────────────────────────────────────────────────

type authHandler struct {
	svc Services
}

func newAuthHandler(svc Services) *authHandler {
	return &authHandler{svc: svc}
}

// RedirectToGoogle handles GET /api/v1/auth/google
func (h *authHandler) RedirectToGoogle(w http.ResponseWriter, r *http.Request) {
	url := h.svc.Auth.GoogleAuthURL(w)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// Callback handles GET /api/v1/auth/google/callback
func (h *authHandler) Callback(w http.ResponseWriter, r *http.Request) {
	userInfo, err := h.svc.Auth.GoogleExchange(r.Context(), r)
	if err != nil {
		http.Redirect(w, r, h.svc.Config.FrontendURL+"/login?error=oauth_failed", http.StatusTemporaryRedirect)
		return
	}

	userQ := queries.NewUserQueries(h.svc.DB)

	// Upsert user — creates on first login, updates name/avatar on subsequent logins
	user, err := userQ.Upsert(r.Context(), userInfo.Email, userInfo.Name, userInfo.AvatarURL)
	if err != nil {
		http.Redirect(w, r, h.svc.Config.FrontendURL+"/login?error=db_error", http.StatusTemporaryRedirect)
		return
	}

	// Check platform admin status
	isPlatAdmin, _ := userQ.IsPlatformAdmin(r.Context(), user.Email)

	// Issue JWT
	token, err := h.svc.Auth.IssueToken(r.Context(), user.ID, user.Email, isPlatAdmin)
	if err != nil {
		http.Redirect(w, r, h.svc.Config.FrontendURL+"/login?error=token_error", http.StatusTemporaryRedirect)
		return
	}

	// Redirect to frontend with token in query param
	// Frontend stores it in memory / httpOnly cookie
	http.Redirect(w, r,
		h.svc.Config.FrontendURL+"/auth/callback?token="+token,
		http.StatusTemporaryRedirect,
	)
}

// Logout handles POST /api/v1/auth/logout
func (h *authHandler) Logout(w http.ResponseWriter, r *http.Request) {
	tokenStr, err := auth.ExtractBearer(r.Header.Get("Authorization"))
	if err == nil {
		_ = h.svc.Auth.RevokeToken(r.Context(), tokenStr)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}

// Me handles GET /api/v1/auth/me
func (h *authHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userQ := queries.NewUserQueries(h.svc.DB)
	orgQ := queries.NewOrgQueries(h.svc.DB)

	user, err := userQ.GetByID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, "user not found", http.StatusNotFound)
		return
	}

	orgs, _ := orgQ.ListForUser(r.Context(), claims.UserID)
	if orgs == nil {
		orgs = []queries.Organization{}
	}

	isPlatAdmin, _ := userQ.IsPlatformAdmin(r.Context(), user.Email)

	writeJSON(w, http.StatusOK, queries.MeResponse{
		User:    user,
		Orgs:    orgs,
		IsAdmin: isPlatAdmin,
	})
}

// ── Org handler ───────────────────────────────────────────────────────────────

type orgHandler struct {
	svc Services
}

func newOrgHandler(svc Services) *orgHandler {
	return &orgHandler{svc: svc}
}

// ListMyOrgs handles GET /api/v1/orgs
func (h *orgHandler) ListMyOrgs(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	orgQ := queries.NewOrgQueries(h.svc.DB)

	orgs, err := orgQ.ListForUser(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, "failed to list orgs", http.StatusInternalServerError)
		return
	}
	if orgs == nil {
		orgs = []queries.Organization{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"orgs": orgs})
}

// GetOrg handles GET /api/v1/orgs/:orgId
func (h *orgHandler) GetOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	org, err := orgQ.GetByID(r.Context(), orgID)
	if err != nil {
		writeError(w, "org not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, org)
}

// ── Shared JSON helpers ───────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, msg string, status int) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeBody(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
