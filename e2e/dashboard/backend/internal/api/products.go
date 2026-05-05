package api

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type Product struct {
	ID          uuid.UUID `json:"id"`
	OrgID       uuid.UUID `json:"org_id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	CreatedAt   time.Time `json:"created_at"`
}

// ── productHandler ────────────────────────────────────────────────────────────

type productHandler struct {
	svc Services
}

func newProductHandler(svc Services) *productHandler {
	return &productHandler{svc: svc}
}

// List handles GET /api/v1/orgs/:orgId/products
func (h *productHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	products, err := listProducts(r.Context(), h.svc.DB, orgID)
	if err != nil {
		writeError(w, "failed to list products", http.StatusInternalServerError)
		return
	}
	if products == nil {
		products = []Product{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"products": products})
}

// Create handles POST /api/v1/orgs/:orgId/products
func (h *productHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
		Icon        string `json:"icon"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" || body.Slug == "" {
		writeError(w, "name and slug are required", http.StatusBadRequest)
		return
	}

	var p Product
	err = h.svc.DB.QueryRow(r.Context(), `
		INSERT INTO products (org_id, name, slug, description, icon)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, org_id, name, slug, COALESCE(description,''), COALESCE(icon,''), created_at
	`, orgID, body.Name, body.Slug, body.Description, body.Icon).Scan(
		&p.ID, &p.OrgID, &p.Name, &p.Slug, &p.Description, &p.Icon, &p.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to create product (slug may be taken)", http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// Update handles PUT /api/v1/orgs/:orgId/products/:productId
func (h *productHandler) Update(w http.ResponseWriter, r *http.Request) {
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid productId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
		Icon        string `json:"icon"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	var p Product
	err = h.svc.DB.QueryRow(r.Context(), `
		UPDATE products
		SET name = $2, slug = $3, description = $4, icon = $5
		WHERE id = $1
		RETURNING id, org_id, name, slug, COALESCE(description,''), COALESCE(icon,''), created_at
	`, productID, body.Name, body.Slug, body.Description, body.Icon).Scan(
		&p.ID, &p.OrgID, &p.Name, &p.Slug, &p.Description, &p.Icon, &p.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to update product", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// Delete handles DELETE /api/v1/orgs/:orgId/products/:productId
func (h *productHandler) Delete(w http.ResponseWriter, r *http.Request) {
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid productId", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	tx, err := h.svc.DB.Begin(ctx)
	if err != nil {
		writeError(w, "failed to delete product", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// NULL out run_items references to test cases inside this product
	// (run_items.test_case_id has no ON DELETE CASCADE)
	if _, err := tx.Exec(ctx, `
		UPDATE run_items SET test_case_id = NULL
		WHERE test_case_id IN (
			SELECT tc.id FROM test_cases tc
			JOIN test_folders tf ON tf.id = tc.folder_id
			JOIN sub_projects sp ON sp.id = tf.sub_project_id
			WHERE sp.product_id = $1
		)
	`, productID); err != nil {
		writeError(w, "failed to delete product: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// NULL out pipeline_steps references to sub_projects inside this product
	// (pipeline_steps.sub_project_id has no ON DELETE CASCADE)
	if _, err := tx.Exec(ctx, `
		UPDATE pipeline_steps SET sub_project_id = NULL
		WHERE sub_project_id IN (
			SELECT id FROM sub_projects WHERE product_id = $1
		)
	`, productID); err != nil {
		writeError(w, "failed to delete product: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Now delete the product — cascades to sub_projects → folders → tests
	if _, err := tx.Exec(ctx, `DELETE FROM products WHERE id = $1`, productID); err != nil {
		writeError(w, "failed to delete product: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, "failed to delete product", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Shared DB helper ──────────────────────────────────────────────────────────

func listProducts(ctx context.Context, db *pgxpool.Pool, orgID uuid.UUID) ([]Product, error) {
	rows, err := db.Query(ctx, `
		SELECT id, org_id, name, slug, COALESCE(description,''), COALESCE(icon,''), created_at
		FROM products WHERE org_id = $1 ORDER BY name ASC
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.OrgID, &p.Name, &p.Slug, &p.Description, &p.Icon, &p.CreatedAt); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}
