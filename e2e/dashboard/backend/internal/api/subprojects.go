package api

import (
	"net/http"
	"time"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

// ── Models ────────────────────────────────────────────────────────────────────

type SubProject struct {
	ID        uuid.UUID `json:"id"`
	ProductID uuid.UUID `json:"product_id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	AuthType  string    `json:"auth_type"`
	CreatedAt time.Time `json:"created_at"`
}

// ── subProjectHandler ─────────────────────────────────────────────────────────

type subProjectHandler struct {
	svc Services
}

func newSubProjectHandler(svc Services) *subProjectHandler {
	return &subProjectHandler{svc: svc}
}

// List handles GET /api/v1/orgs/:orgId/products/:productId/subprojects
func (h *subProjectHandler) List(w http.ResponseWriter, r *http.Request) {
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid productId", http.StatusBadRequest)
		return
	}

	rows, err := h.svc.DB.Query(r.Context(), `
		SELECT id, product_id, name, slug, auth_type, created_at
		FROM sub_projects WHERE product_id = $1 ORDER BY name ASC
	`, productID)
	if err != nil {
		writeError(w, "failed to list sub-projects", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var sps []SubProject
	for rows.Next() {
		var sp SubProject
		if err := rows.Scan(&sp.ID, &sp.ProductID, &sp.Name, &sp.Slug, &sp.AuthType, &sp.CreatedAt); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		sps = append(sps, sp)
	}
	if sps == nil {
		sps = []SubProject{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sub_projects": sps})
}

// Create handles POST /api/v1/orgs/:orgId/products/:productId/subprojects
func (h *subProjectHandler) Create(w http.ResponseWriter, r *http.Request) {
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid productId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		AuthType string `json:"auth_type"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" || body.Slug == "" {
		writeError(w, "name and slug are required", http.StatusBadRequest)
		return
	}
	if body.AuthType == "" {
		body.AuthType = "credentials"
	}

	claims := auth.ClaimsFromContext(r.Context())

	var sp SubProject
	err = h.svc.DB.QueryRow(r.Context(), `
		INSERT INTO sub_projects (product_id, name, slug, auth_type)
		VALUES ($1, $2, $3, $4)
		RETURNING id, product_id, name, slug, auth_type, created_at
	`, productID, body.Name, body.Slug, body.AuthType).Scan(
		&sp.ID, &sp.ProductID, &sp.Name, &sp.Slug, &sp.AuthType, &sp.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to create sub-project (slug may be taken)", http.StatusConflict)
		return
	}

	// Auto-create root folder so tests can be uploaded immediately
	folderQ := queries.NewFolderQueries(h.svc.DB)
	folderQ.Create(r.Context(), sp.ID, nil, "root", claims.UserID)

	writeJSON(w, http.StatusCreated, sp)
}

// RootFolder handles GET /api/v1/subprojects/:spId/root-folder
// Returns (or lazily creates) the root folder for a sub-project.
func (h *subProjectHandler) RootFolder(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())
	folderQ := queries.NewFolderQueries(h.svc.DB)

	// Look for existing root folder (parent_id IS NULL)
	var rootID uuid.UUID
	err = h.svc.DB.QueryRow(r.Context(),
		`SELECT id FROM test_folders WHERE sub_project_id = $1 AND parent_id IS NULL ORDER BY created_at ASC LIMIT 1`,
		spID,
	).Scan(&rootID)

	if err != nil {
		// None exists — create one now
		folder, cerr := folderQ.Create(r.Context(), spID, nil, "root", claims.UserID)
		if cerr != nil {
			writeError(w, "failed to create root folder", http.StatusInternalServerError)
			return
		}
		rootID = folder.ID
	}

	writeJSON(w, http.StatusOK, map[string]string{"folder_id": rootID.String()})
}

// Update handles PUT /api/v1/orgs/:orgId/products/:productId/subprojects/:spId
func (h *subProjectHandler) Update(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		AuthType string `json:"auth_type"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	var sp SubProject
	err = h.svc.DB.QueryRow(r.Context(), `
		UPDATE sub_projects SET name = $2, slug = $3, auth_type = $4
		WHERE id = $1
		RETURNING id, product_id, name, slug, auth_type, created_at
	`, spID, body.Name, body.Slug, body.AuthType).Scan(
		&sp.ID, &sp.ProductID, &sp.Name, &sp.Slug, &sp.AuthType, &sp.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to update sub-project", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

// Delete handles DELETE /api/v1/orgs/:orgId/products/:productId/subprojects/:spId
func (h *subProjectHandler) Delete(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	tx, err := h.svc.DB.Begin(ctx)
	if err != nil {
		writeError(w, "failed to delete sub-project", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// NULL out run_items references to test cases inside this sub-project
	if _, err := tx.Exec(ctx, `
		UPDATE run_items SET test_case_id = NULL
		WHERE test_case_id IN (
			SELECT tc.id FROM test_cases tc
			JOIN test_folders tf ON tf.id = tc.folder_id
			WHERE tf.sub_project_id = $1
		)
	`, spID); err != nil {
		writeError(w, "failed to delete sub-project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// NULL out pipeline_steps references to this sub-project
	if _, err := tx.Exec(ctx, `
		UPDATE pipeline_steps SET sub_project_id = NULL WHERE sub_project_id = $1
	`, spID); err != nil {
		writeError(w, "failed to delete sub-project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Delete the sub-project — cascades to folders → tests
	if _, err := tx.Exec(ctx, `DELETE FROM sub_projects WHERE id = $1`, spID); err != nil {
		writeError(w, "failed to delete sub-project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, "failed to delete sub-project", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
