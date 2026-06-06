package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

// ── folderHandler ─────────────────────────────────────────────────────────────

type folderHandler struct {
	svc Services
}

func newFolderHandler(svc Services) *folderHandler {
	return &folderHandler{svc: svc}
}

// Tree handles GET /api/v1/subprojects/:spId/folders
// Returns the full nested folder tree for a sub-project.
func (h *folderHandler) Tree(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForSubProject(r.Context(), h.svc.DB, spID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	folderQ := queries.NewFolderQueries(h.svc.DB)

	flat, err := folderQ.ListBySubProject(r.Context(), spID)
	if err != nil {
		writeError(w, "failed to list folders", http.StatusInternalServerError)
		return
	}

	tree := queries.BuildTree(flat)
	if tree == nil {
		tree = []queries.TestFolder{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"folders": tree})
}

// Create handles POST /api/v1/subprojects/:spId/folders
func (h *folderHandler) Create(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForSubProject(r.Context(), h.svc.DB, spID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	var body struct {
		Name     string  `json:"name"`
		ParentID *string `json:"parent_id"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	var parentID *uuid.UUID
	if body.ParentID != nil && *body.ParentID != "" {
		pid, err := uuid.Parse(*body.ParentID)
		if err != nil {
			writeError(w, "invalid parent_id", http.StatusBadRequest)
			return
		}
		parentID = &pid
	}

	folderQ := queries.NewFolderQueries(h.svc.DB)
	folder, err := folderQ.Create(r.Context(), spID, parentID, body.Name, claims.UserID)
	if err != nil {
		writeError(w, "failed to create folder", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, folder)
}

// Rename handles PUT /api/v1/folders/:folderId
func (h *folderHandler) Rename(w http.ResponseWriter, r *http.Request) {
	folderID, err := uuid.Parse(r.PathValue("folderId"))
	if err != nil {
		writeError(w, "invalid folderId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForFolder(r.Context(), h.svc.DB, folderID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	folderQ := queries.NewFolderQueries(h.svc.DB)
	if err := folderQ.Rename(r.Context(), folderID, body.Name); err != nil {
		writeError(w, "failed to rename folder", http.StatusInternalServerError)
		return
	}

	folder, _ := folderQ.GetByID(r.Context(), folderID)
	writeJSON(w, http.StatusOK, folder)
}

// Delete handles DELETE /api/v1/folders/:folderId
// Only succeeds if the folder is empty (no children, no test cases).
func (h *folderHandler) Delete(w http.ResponseWriter, r *http.Request) {
	folderID, err := uuid.Parse(r.PathValue("folderId"))
	if err != nil {
		writeError(w, "invalid folderId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForFolder(r.Context(), h.svc.DB, folderID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	folderQ := queries.NewFolderQueries(h.svc.DB)
	if err := folderQ.Delete(r.Context(), folderID); err != nil {
		writeError(w, err.Error(), http.StatusConflict)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
