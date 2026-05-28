package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

type adminHandler struct {
	svc Services
}

func newAdminHandler(svc Services) *adminHandler {
	return &adminHandler{svc: svc}
}

// ListOrgs handles GET /api/v1/admin/orgs
func (h *adminHandler) ListOrgs(w http.ResponseWriter, r *http.Request) {
	orgQ := queries.NewOrgQueries(h.svc.DB)
	orgs, err := orgQ.ListAll(r.Context())
	if err != nil {
		writeError(w, "failed to list orgs", http.StatusInternalServerError)
		return
	}
	if orgs == nil {
		orgs = []queries.Organization{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"orgs": orgs})
}

// CreateOrg handles POST /api/v1/admin/orgs
func (h *adminHandler) CreateOrg(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		IsActive *bool  `json:"is_active"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" || body.Slug == "" {
		writeError(w, "name and slug are required", http.StatusBadRequest)
		return
	}

	isActive := true
	if body.IsActive != nil {
		isActive = *body.IsActive
	}

	claims := auth.ClaimsFromContext(r.Context())
	orgQ := queries.NewOrgQueries(h.svc.DB)
	org, err := orgQ.Create(r.Context(), body.Name, body.Slug, isActive)
	if err != nil {
		writeError(w, "failed to create org (slug may be taken)", http.StatusConflict)
		return
	}

	// Auto-add creator as admin member
	_, _ = orgQ.AddMember(r.Context(), org.ID, claims.UserID, "admin")

	writeJSON(w, http.StatusCreated, org)
}

// JoinOrg handles POST /api/v1/admin/orgs/:orgId/join
// Lets a platform admin add themselves to any org as admin.
func (h *adminHandler) JoinOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())
	orgQ := queries.NewOrgQueries(h.svc.DB)
	if _, err := orgQ.AddMember(r.Context(), orgID, claims.UserID, "admin"); err != nil {
		writeError(w, "failed to join org", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "joined"})
}

// UpdateOrg handles PUT /api/v1/admin/orgs/:orgId
func (h *adminHandler) UpdateOrg(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name     string            `json:"name"`
		Slug     string            `json:"slug"`
		IsActive bool              `json:"is_active"`
		Theme    map[string]string `json:"theme"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	org, err := orgQ.Update(r.Context(), orgID, body.Name, body.Slug, body.IsActive, body.Theme)
	if err != nil {
		writeError(w, "failed to update org", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, org)
}

// ListUsers handles GET /api/v1/admin/users
func (h *adminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	userQ := queries.NewUserQueries(h.svc.DB)
	users, err := userQ.ListAll(r.Context())
	if err != nil {
		writeError(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []queries.User{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// ListOrgMembers handles GET /api/v1/admin/orgs/:orgId/members
func (h *adminHandler) ListOrgMembers(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	members, err := orgQ.ListMembers(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to list members", http.StatusInternalServerError)
		return
	}
	if members == nil {
		members = []queries.OrgMember{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// AddOrgMember handles POST /api/v1/admin/orgs/:orgId/members
func (h *adminHandler) AddOrgMember(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var body struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := decodeBody(r, &body); err != nil || body.UserID == "" {
		writeError(w, "user_id is required", http.StatusBadRequest)
		return
	}
	userID, err := uuid.Parse(body.UserID)
	if err != nil {
		writeError(w, "invalid user_id", http.StatusBadRequest)
		return
	}
	if body.Role == "" {
		body.Role = "member"
	}
	if body.Role != "admin" && body.Role != "member" {
		writeError(w, "role must be 'admin' or 'member'", http.StatusBadRequest)
		return
	}

	userQ := queries.NewUserQueries(h.svc.DB)
	user, err := userQ.GetByID(r.Context(), userID)
	if err != nil {
		writeError(w, "user not found", http.StatusNotFound)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	member, err := orgQ.AddMember(r.Context(), orgID, userID, body.Role)
	if err != nil {
		writeError(w, "failed to add member", http.StatusInternalServerError)
		return
	}
	member.UserName = user.Name
	member.UserEmail = user.Email
	member.AvatarURL = user.AvatarURL
	writeJSON(w, http.StatusCreated, member)
}

// RemoveOrgMember handles DELETE /api/v1/admin/orgs/:orgId/members/:userId
func (h *adminHandler) RemoveOrgMember(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	userID, err := uuid.Parse(r.PathValue("userId"))
	if err != nil {
		writeError(w, "invalid userId", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	memberID, err := orgQ.GetMemberID(r.Context(), orgID, userID)
	if err != nil {
		writeError(w, "membership not found", http.StatusNotFound)
		return
	}
	if err := orgQ.RemoveMember(r.Context(), memberID); err != nil {
		writeError(w, "failed to remove member", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}
