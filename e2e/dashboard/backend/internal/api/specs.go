package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type specsHandler struct{ svc Services }

func newSpecsHandler(svc Services) *specsHandler { return &specsHandler{svc: svc} }

// SpecNode represents a file or directory in the spec tree.
type SpecNode struct {
	Name     string      `json:"name"`
	Path     string      `json:"path"` // relative to specs root
	IsDir    bool        `json:"is_dir"`
	Children []*SpecNode `json:"children,omitempty"`
}

// specsDir returns the absolute path to the specs directory.
func specsDir() (string, error) {
	base := os.Getenv("SCOUT_PLAYWRIGHT_PROJECT_DIR")
	if base == "" {
		cwd, _ := os.Getwd()
		base = runner.FindPlaywrightProjectDir(cwd)
	}
	if base == "" {
		return "", fmt.Errorf("could not locate Playwright project — set SCOUT_PLAYWRIGHT_PROJECT_DIR")
	}
	return filepath.Join(base, "specs"), nil
}

// Tree handles GET /api/v1/orgs/:orgId/specs
// Returns a recursive tree of spec files on disk.
func (h *specsHandler) Tree(w http.ResponseWriter, r *http.Request) {
	dir, err := specsDir()
	if err != nil {
		writeError(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		writeJSON(w, http.StatusOK, map[string]any{"nodes": []any{}})
		return
	}

	nodes, err := walkSpecDir(dir, "")
	if err != nil {
		writeError(w, "failed to read specs directory", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

func walkSpecDir(base, rel string) ([]*SpecNode, error) {
	dir := base
	if rel != "" {
		dir = filepath.Join(base, rel)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var nodes []*SpecNode
	for _, e := range entries {
		name := e.Name()
		// Skip hidden files/dirs and non-spec files at root level
		if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
			continue
		}

		relPath := name
		if rel != "" {
			relPath = rel + "/" + name
		}

		node := &SpecNode{Name: name, Path: relPath, IsDir: e.IsDir()}

		if e.IsDir() {
			children, err := walkSpecDir(base, relPath)
			if err != nil {
				continue
			}
			node.Children = children
		} else {
			// Only include .spec.ts, .spec.js, .ts, .js files
			ext := strings.ToLower(filepath.Ext(name))
			if ext != ".ts" && ext != ".js" {
				continue
			}
		}

		nodes = append(nodes, node)
	}
	return nodes, nil
}

// Run handles POST /api/v1/orgs/:orgId/specs/run
// Reads spec files from disk, upserts them into the DB as test cases in a
// system "__local__" product, then starts a normal run.
func (h *specsHandler) Run(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Paths         []string `json:"paths"`          // relative paths under specs/
		EnvironmentID string   `json:"environment_id"`
		Label         string   `json:"label"`
		Headed        bool     `json:"headed"`
	}
	if err := decodeBody(r, &body); err != nil || len(body.Paths) == 0 {
		writeError(w, "paths is required", http.StatusBadRequest)
		return
	}

	dir, err := specsDir()
	if err != nil {
		writeError(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	// Ensure the __local__ product / subproject / root folder exist.
	spID, rootFolderID, err := h.ensureLocalSpecsHierarchy(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to prepare local specs hierarchy: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_ = spID

	// Upsert each requested spec file as a test case.
	testQ := queries.NewTestQueries(h.svc.DB)
	var testCaseIDs []uuid.UUID

	for _, relPath := range body.Paths {
		// Security: prevent path traversal. Clean the path, reject absolute paths,
		// then verify the resolved fullPath is still inside the specs dir.
		native := filepath.Clean(filepath.FromSlash(relPath))
		if filepath.IsAbs(native) || strings.HasPrefix(native, "..") {
			continue
		}
		fullPath := filepath.Join(dir, native)
		rel, err := filepath.Rel(dir, fullPath)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		clean := filepath.ToSlash(native)

		content, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}

		tcID, err := h.upsertSpecTestCase(r.Context(), testQ, rootFolderID, clean, string(content), &claims.UserID)
		if err != nil {
			continue
		}
		testCaseIDs = append(testCaseIDs, tcID)
	}

	if len(testCaseIDs) == 0 {
		writeError(w, "no readable spec files found at the given paths", http.StatusBadRequest)
		return
	}

	// Parse optional environment ID.
	var envID *uuid.UUID
	if body.EnvironmentID != "" {
		id, err := uuid.Parse(body.EnvironmentID)
		if err != nil {
			writeError(w, "invalid environment_id", http.StatusBadRequest)
			return
		}
		envID = &id
	}

	label := body.Label
	if label == "" {
		label = "Spec run"
	}

	runQ := queries.NewRunQueries(h.svc.DB)
	run, err := runQ.Create(r.Context(), orgID, envID, &claims.UserID, label, nil)
	if err != nil {
		writeError(w, "failed to create run", http.StatusInternalServerError)
		return
	}

	for _, tcID := range testCaseIDs {
		id := tcID
		if _, err := runQ.CreateItem(r.Context(), run.ID, &id, nil); err != nil {
			continue
		}
	}

	h.svc.Runner.Enqueue(&runner.RunJob{
		RunID:  run.ID,
		OrgID:  orgID,
		Headed: body.Headed,
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"run_id": run.ID,
		"status": "queued",
		"label":  run.Label,
	})
}

// ensureLocalSpecsHierarchy finds or creates the __local__ product →
// specs sub-project → root folder chain, returning (subProjectID, rootFolderID).
func (h *specsHandler) ensureLocalSpecsHierarchy(ctx context.Context, orgID uuid.UUID) (uuid.UUID, uuid.UUID, error) {
	db := h.svc.DB

	// Product
	var productID uuid.UUID
	err := db.QueryRow(ctx, `
		INSERT INTO products (org_id, name, slug, created_at)
		VALUES ($1, 'Local Specs', '__local__', $2)
		ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`, orgID, time.Now()).Scan(&productID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("upsert product: %w", err)
	}

	// Sub-project
	var spID uuid.UUID
	err = db.QueryRow(ctx, `
		INSERT INTO sub_projects (product_id, name, slug, created_at)
		VALUES ($1, 'Specs', 'specs', $2)
		ON CONFLICT (product_id, slug) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`, productID, time.Now()).Scan(&spID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("upsert subproject: %w", err)
	}

	// Root folder
	var rootFolderID uuid.UUID
	err = db.QueryRow(ctx, `
		SELECT id FROM test_folders
		WHERE sub_project_id = $1 AND parent_id IS NULL
		LIMIT 1
	`, spID).Scan(&rootFolderID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, uuid.Nil, fmt.Errorf("query root folder: %w", err)
		}
		// Not found — create it
		err = db.QueryRow(ctx, `
			INSERT INTO test_folders (sub_project_id, parent_id, name, path, created_at)
			VALUES ($1, NULL, '__root__', '', $2)
			RETURNING id
		`, spID, time.Now()).Scan(&rootFolderID)
		if err != nil {
			return uuid.Nil, uuid.Nil, fmt.Errorf("create root folder: %w", err)
		}
	}

	return spID, rootFolderID, nil
}

// upsertSpecTestCase inserts or updates a test case by file_name within the folder.
func (h *specsHandler) upsertSpecTestCase(
	ctx context.Context,
	_ *queries.TestQueries,
	folderID uuid.UUID,
	relPath string,
	content string,
	userID *uuid.UUID,
) (uuid.UUID, error) {
	db := h.svc.DB
	name := filepath.Base(filepath.FromSlash(relPath))

	var tcID uuid.UUID
	err := db.QueryRow(ctx, `
		SELECT id FROM test_cases WHERE folder_id = $1 AND file_name = $2 LIMIT 1
	`, folderID, relPath).Scan(&tcID)

	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, fmt.Errorf("lookup test case %s: %w", relPath, err)
		}
		// Not found — insert
		err = db.QueryRow(ctx, `
			INSERT INTO test_cases (folder_id, name, file_name, file_content, created_by, updated_by, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $5, $6, $6)
			RETURNING id
		`, folderID, name, relPath, content, userID, time.Now()).Scan(&tcID)
		if err != nil {
			return uuid.Nil, fmt.Errorf("insert test case %s: %w", relPath, err)
		}
	} else {
		// Found — update content
		_, err = db.Exec(ctx, `
			UPDATE test_cases SET file_content = $1, updated_by = $2, updated_at = $3
			WHERE id = $4
		`, content, userID, time.Now(), tcID)
		if err != nil {
			return uuid.Nil, fmt.Errorf("update test case %s: %w", relPath, err)
		}
	}

	return tcID, nil
}
