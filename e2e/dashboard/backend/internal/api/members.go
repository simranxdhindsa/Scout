package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

type memberHandler struct {
	svc Services
}

func newMemberHandler(svc Services) *memberHandler {
	return &memberHandler{svc: svc}
}

// List handles GET /api/v1/orgs/:orgId/members
func (h *memberHandler) List(w http.ResponseWriter, r *http.Request) {
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

	// Enrich each member with their project access
	for i, m := range members {
		access, _ := orgQ.ListProjectAccessForMember(r.Context(), m.ID)
		if access == nil {
			access = []queries.ProjectAccess{}
		}
		_ = access
		members[i] = m
	}

	writeJSON(w, http.StatusOK, map[string]any{"members": members})
}

// Add handles POST /api/v1/orgs/:orgId/members
func (h *memberHandler) Add(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeBody(r, &body); err != nil || body.Email == "" {
		writeError(w, "email is required", http.StatusBadRequest)
		return
	}
	if body.Role == "" {
		body.Role = "member"
	}

	userQ := queries.NewUserQueries(h.svc.DB)
	orgQ := queries.NewOrgQueries(h.svc.DB)

	// Find user by email — they must have logged in at least once
	user, err := userQ.GetByEmail(r.Context(), body.Email)
	if err != nil {
		writeError(w, "user not found — they must sign in with Google first", http.StatusNotFound)
		return
	}

	member, err := orgQ.AddMember(r.Context(), orgID, user.ID, body.Role)
	if err != nil {
		writeError(w, "failed to add member", http.StatusInternalServerError)
		return
	}

	member.UserEmail = user.Email
	member.UserName = user.Name
	member.AvatarURL = user.AvatarURL

	writeJSON(w, http.StatusCreated, member)
}

// Update handles PUT /api/v1/orgs/:orgId/members/:memberId
// Updates role and/or per-sub-project access.
func (h *memberHandler) Update(w http.ResponseWriter, r *http.Request) {
	memberID, err := uuid.Parse(r.PathValue("memberId"))
	if err != nil {
		writeError(w, "invalid memberId", http.StatusBadRequest)
		return
	}

	var body struct {
		Role   string `json:"role"`
		Access []struct {
			SubProjectID     string `json:"sub_project_id"`
			CanWrite         bool   `json:"can_write"`
			CanRequestDelete bool   `json:"can_request_delete"`
		} `json:"access"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)

	if body.Role != "" {
		if err := orgQ.UpdateMemberRole(r.Context(), memberID, body.Role); err != nil {
			writeError(w, "failed to update role", http.StatusInternalServerError)
			return
		}
	}

	for _, a := range body.Access {
		spID, err := uuid.Parse(a.SubProjectID)
		if err != nil {
			continue
		}
		_ = orgQ.SetProjectAccess(r.Context(), memberID, spID, a.CanWrite, a.CanRequestDelete)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// Remove handles DELETE /api/v1/orgs/:orgId/members/:memberId
func (h *memberHandler) Remove(w http.ResponseWriter, r *http.Request) {
	memberID, err := uuid.Parse(r.PathValue("memberId"))
	if err != nil {
		writeError(w, "invalid memberId", http.StatusBadRequest)
		return
	}

	orgQ := queries.NewOrgQueries(h.svc.DB)
	if err := orgQ.RemoveMember(r.Context(), memberID); err != nil {
		writeError(w, "failed to remove member", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}
