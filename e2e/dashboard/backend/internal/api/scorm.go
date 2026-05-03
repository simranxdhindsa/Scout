package api

import (
	"net/http"

	"github.com/google/uuid"
)

// scormAdminHandler handles admin-only SCORM generator management.
// Regular SCORM routes (upload, generate, snapshots) are served directly
// by scorm.Service.HandleXxx registered in router.go.
type scormAdminHandler struct {
	svc Services
}

func newScormAdminHandler(svc Services) *scormAdminHandler {
	return &scormAdminHandler{svc: svc}
}

// ToggleGenerator handles PUT /api/v1/orgs/:orgId/scorm/generators/:generatorId/toggle
// Allows org admins to activate or deactivate individual generators.
func (h *scormAdminHandler) ToggleGenerator(w http.ResponseWriter, r *http.Request) {
	generatorID, err := uuid.Parse(r.PathValue("generatorId"))
	if err != nil {
		writeError(w, "invalid generatorId", http.StatusBadRequest)
		return
	}

	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	if err := h.svc.SCORM.ToggleGenerator(r.Context(), generatorID, body.IsActive); err != nil {
		writeError(w, "failed to toggle generator", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"generator_id": generatorID,
		"is_active":    body.IsActive,
	})
}
