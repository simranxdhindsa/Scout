package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type ProductGitlabLink struct {
	IntegrationID uuid.UUID `json:"integration_id"`
	RepoID        int64     `json:"repo_id"`
	RepoName      string    `json:"repo_name"`
	RepoURL       string    `json:"repo_url"`
	Branch        string    `json:"branch"`
	RepoPath      string    `json:"repo_path"`
}

type Product struct {
	ID          uuid.UUID          `json:"id"`
	OrgID       uuid.UUID          `json:"org_id"`
	Name        string             `json:"name"`
	Slug        string             `json:"slug"`
	Description string             `json:"description"`
	Icon        string             `json:"icon"`
	CreatedAt   time.Time          `json:"created_at"`
	Gitlab      *ProductGitlabLink `json:"gitlab,omitempty"`
}

type productGitlabInput struct {
	IntegrationID string `json:"integration_id"`
	RepoID        int64  `json:"repo_id"`
	RepoName      string `json:"repo_name"`
	RepoURL       string `json:"repo_url"`
	Branch        string `json:"branch"`
	RepoPath      string `json:"repo_path"`
}

func (in *productGitlabInput) toLink() (ProductGitlabLink, error) {
	id, err := uuid.Parse(in.IntegrationID)
	if err != nil {
		return ProductGitlabLink{}, err
	}
	branch := in.Branch
	if branch == "" {
		branch = "main"
	}
	return ProductGitlabLink{
		IntegrationID: id,
		RepoID:        in.RepoID,
		RepoName:      in.RepoName,
		RepoURL:       in.RepoURL,
		Branch:        branch,
		RepoPath:      in.RepoPath,
	}, nil
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
		Name        string              `json:"name"`
		Slug        string              `json:"slug"`
		Description string              `json:"description"`
		Icon        string              `json:"icon"`
		Gitlab      *productGitlabInput `json:"gitlab"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" || body.Slug == "" {
		writeError(w, "name and slug are required", http.StatusBadRequest)
		return
	}

	var link *ProductGitlabLink
	if body.Gitlab != nil && body.Gitlab.IntegrationID != "" {
		l, err := body.Gitlab.toLink()
		if err != nil {
			writeError(w, "invalid gitlab.integration_id", http.StatusBadRequest)
			return
		}
		link = &l
	}

	ctx := r.Context()
	tx, err := h.svc.DB.Begin(ctx)
	if err != nil {
		writeError(w, "failed to create product", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var p Product
	err = tx.QueryRow(ctx, `
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

	if link != nil {
		if err := upsertProductGitlabLink(ctx, tx, p.ID, *link); err != nil {
			writeError(w, "failed to link gitlab repo: "+err.Error(), http.StatusInternalServerError)
			return
		}
		p.Gitlab = link
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, "failed to create product", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, p)
}

// Update handles PUT /api/v1/orgs/:orgId/products/:productId
//
// Pass `"gitlab": { ... }` to attach or replace the GitLab link, `"gitlab": null`
// to clear it, or omit the field to leave it untouched.
func (h *productHandler) Update(w http.ResponseWriter, r *http.Request) {
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid productId", http.StatusBadRequest)
		return
	}

	var raw map[string]json.RawMessage
	if err := decodeBody(r, &raw); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	getStr := func(k string) string {
		v, ok := raw[k]
		if !ok {
			return ""
		}
		var s string
		_ = json.Unmarshal(v, &s)
		return s
	}

	name := getStr("name")
	slug := getStr("slug")
	description := getStr("description")
	icon := getStr("icon")

	ctx := r.Context()
	tx, err := h.svc.DB.Begin(ctx)
	if err != nil {
		writeError(w, "failed to update product", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var p Product
	err = tx.QueryRow(ctx, `
		UPDATE products
		SET name = $2, slug = $3, description = $4, icon = $5
		WHERE id = $1
		RETURNING id, org_id, name, slug, COALESCE(description,''), COALESCE(icon,''), created_at
	`, productID, name, slug, description, icon).Scan(
		&p.ID, &p.OrgID, &p.Name, &p.Slug, &p.Description, &p.Icon, &p.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to update product", http.StatusInternalServerError)
		return
	}

	if gitlabRaw, present := raw["gitlab"]; present {
		if string(gitlabRaw) == "null" {
			if _, err := tx.Exec(ctx, `DELETE FROM product_gitlab_links WHERE product_id = $1`, p.ID); err != nil {
				writeError(w, "failed to clear gitlab link", http.StatusInternalServerError)
				return
			}
		} else {
			var in productGitlabInput
			if err := json.Unmarshal(gitlabRaw, &in); err != nil {
				writeError(w, "invalid gitlab block", http.StatusBadRequest)
				return
			}
			if in.IntegrationID != "" {
				link, err := in.toLink()
				if err != nil {
					writeError(w, "invalid gitlab.integration_id", http.StatusBadRequest)
					return
				}
				if err := upsertProductGitlabLink(ctx, tx, p.ID, link); err != nil {
					writeError(w, "failed to save gitlab link: "+err.Error(), http.StatusInternalServerError)
					return
				}
				p.Gitlab = &link
			}
		}
	} else {
		// Caller didn't touch gitlab — keep the existing link in the response.
		if link, err := getProductGitlabLink(ctx, tx, p.ID); err == nil {
			p.Gitlab = link
		}
	}

	if err := tx.Commit(ctx); err != nil {
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
	// and to product_gitlab_links.
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

// ── Tests ─────────────────────────────────────────────────────────────────────

type ProductTest struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	FileName   string    `json:"file_name"`
	FolderPath string    `json:"folder_path"`
	IsArchived bool      `json:"is_archived"`
	Version    int       `json:"version"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Tests handles GET /api/v1/orgs/:orgId/products/:productId/tests
//
// Returns every test case under the product, walking through sub-projects and
// folders. Used by the project detail page to show "all scanned spec files".
func (h *productHandler) Tests(w http.ResponseWriter, r *http.Request) {
	productID, err := uuid.Parse(r.PathValue("productId"))
	if err != nil {
		writeError(w, "invalid productId", http.StatusBadRequest)
		return
	}

	rows, err := h.svc.DB.Query(r.Context(), `
		SELECT tc.id, tc.name, tc.file_name,
		       COALESCE(NULLIF(tf.path, ''), tf.name) AS folder_path,
		       tc.is_archived, tc.version, tc.created_at, tc.updated_at
		FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		JOIN sub_projects sp ON sp.id = tf.sub_project_id
		WHERE sp.product_id = $1
		ORDER BY tc.updated_at DESC
	`, productID)
	if err != nil {
		writeError(w, "failed to list tests", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tests := []ProductTest{}
	for rows.Next() {
		var t ProductTest
		if err := rows.Scan(
			&t.ID, &t.Name, &t.FileName, &t.FolderPath,
			&t.IsArchived, &t.Version, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			writeError(w, "failed to scan test", http.StatusInternalServerError)
			return
		}
		tests = append(tests, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, "failed to list tests", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"tests": tests})
}

// ── Shared DB helpers ────────────────────────────────────────────────────────

func listProducts(ctx context.Context, db *pgxpool.Pool, orgID uuid.UUID) ([]Product, error) {
	rows, err := db.Query(ctx, `
		SELECT p.id, p.org_id, p.name, p.slug,
		       COALESCE(p.description,''), COALESCE(p.icon,''), p.created_at,
		       l.integration_id, l.repo_id, l.repo_name, l.repo_url, l.branch, l.repo_path
		FROM products p
		LEFT JOIN product_gitlab_links l ON l.product_id = p.id
		WHERE p.org_id = $1
		ORDER BY p.name ASC
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		var integID *uuid.UUID
		var repoID *int64
		var repoName, repoURL, branch, repoPath *string
		if err := rows.Scan(
			&p.ID, &p.OrgID, &p.Name, &p.Slug, &p.Description, &p.Icon, &p.CreatedAt,
			&integID, &repoID, &repoName, &repoURL, &branch, &repoPath,
		); err != nil {
			return nil, err
		}
		if integID != nil && repoID != nil {
			p.Gitlab = &ProductGitlabLink{
				IntegrationID: *integID,
				RepoID:        *repoID,
				RepoName:      strOrEmpty(repoName),
				RepoURL:       strOrEmpty(repoURL),
				Branch:        strOrEmpty(branch),
				RepoPath:      strOrEmpty(repoPath),
			}
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func upsertProductGitlabLink(ctx context.Context, tx pgx.Tx, productID uuid.UUID, link ProductGitlabLink) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO product_gitlab_links
		  (product_id, integration_id, repo_id, repo_name, repo_url, branch, repo_path)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (product_id) DO UPDATE
		  SET integration_id = EXCLUDED.integration_id,
		      repo_id        = EXCLUDED.repo_id,
		      repo_name      = EXCLUDED.repo_name,
		      repo_url       = EXCLUDED.repo_url,
		      branch         = EXCLUDED.branch,
		      repo_path      = EXCLUDED.repo_path,
		      updated_at     = NOW()
	`, productID, link.IntegrationID, link.RepoID, link.RepoName, link.RepoURL, link.Branch, link.RepoPath)
	return err
}

func getProductGitlabLink(ctx context.Context, tx pgx.Tx, productID uuid.UUID) (*ProductGitlabLink, error) {
	var link ProductGitlabLink
	err := tx.QueryRow(ctx, `
		SELECT integration_id, repo_id, repo_name, repo_url, branch, repo_path
		FROM product_gitlab_links WHERE product_id = $1
	`, productID).Scan(
		&link.IntegrationID, &link.RepoID, &link.RepoName, &link.RepoURL, &link.Branch, &link.RepoPath,
	)
	if err != nil {
		return nil, err
	}
	return &link, nil
}

func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
