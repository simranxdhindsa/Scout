package api

import (
	"net/http"

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
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" || body.Slug == "" {
		writeError(w, "name and slug are required", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	org, err := orgQ.Create(r.Context(), body.Name, body.Slug)
	if err != nil {
		writeError(w, "failed to create org (slug may be taken)", http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusCreated, org)
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
