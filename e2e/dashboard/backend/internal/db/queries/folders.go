package queries

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type TestFolder struct {
	ID           uuid.UUID  `json:"id"`
	SubProjectID uuid.UUID  `json:"sub_project_id"`
	ParentID     *uuid.UUID `json:"parent_id"`
	Name         string     `json:"name"`
	Path         string     `json:"path"`
	CreatedBy    *uuid.UUID `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
	// Tree fields populated in memory after fetch
	Children  []TestFolder `json:"children,omitempty"`
	TestCases []TestCase   `json:"test_cases,omitempty"`
}

// ── FolderQueries ─────────────────────────────────────────────────────────────

type FolderQueries struct {
	db *pgxpool.Pool
}

func NewFolderQueries(db *pgxpool.Pool) *FolderQueries {
	return &FolderQueries{db: db}
}

// ListBySubProject returns all folders for a sub-project as a flat list.
// Use BuildTree to convert to nested structure.
func (q *FolderQueries) ListBySubProject(ctx context.Context, subProjectID uuid.UUID) ([]TestFolder, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, sub_project_id, parent_id, name, path, created_by, created_at
		FROM test_folders
		WHERE sub_project_id = $1
		ORDER BY path ASC, name ASC
	`, subProjectID)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	defer rows.Close()

	var folders []TestFolder
	for rows.Next() {
		var f TestFolder
		if err := rows.Scan(
			&f.ID, &f.SubProjectID, &f.ParentID, &f.Name, &f.Path,
			&f.CreatedBy, &f.CreatedAt,
		); err != nil {
			return nil, err
		}
		folders = append(folders, f)
	}
	return folders, rows.Err()
}

// GetByID returns a single folder by UUID.
func (q *FolderQueries) GetByID(ctx context.Context, id uuid.UUID) (*TestFolder, error) {
	var f TestFolder
	err := q.db.QueryRow(ctx, `
		SELECT id, sub_project_id, parent_id, name, path, created_by, created_at
		FROM test_folders WHERE id = $1
	`, id).Scan(
		&f.ID, &f.SubProjectID, &f.ParentID, &f.Name, &f.Path,
		&f.CreatedBy, &f.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get folder by id: %w", err)
	}
	return &f, nil
}

// Create inserts a new folder and computes its materialized path.
func (q *FolderQueries) Create(ctx context.Context, subProjectID uuid.UUID, parentID *uuid.UUID, name string, createdBy uuid.UUID) (*TestFolder, error) {
	tx, err := q.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Determine parent path
	parentPath := ""
	if parentID != nil {
		if err := tx.QueryRow(ctx,
			`SELECT path FROM test_folders WHERE id = $1`, *parentID,
		).Scan(&parentPath); err != nil {
			return nil, fmt.Errorf("get parent path: %w", err)
		}
	}

	// Insert folder — path will be set after we have the new ID
	var f TestFolder
	err = tx.QueryRow(ctx, `
		INSERT INTO test_folders (sub_project_id, parent_id, name, path, created_by)
		VALUES ($1, $2, $3, '', $4)
		RETURNING id, sub_project_id, parent_id, name, path, created_by, created_at
	`, subProjectID, parentID, name, createdBy).Scan(
		&f.ID, &f.SubProjectID, &f.ParentID, &f.Name, &f.Path,
		&f.CreatedBy, &f.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert folder: %w", err)
	}

	// Build materialized path: '/parentPath/newID'
	var matPath string
	if parentPath == "" {
		matPath = "/" + f.ID.String()
	} else {
		matPath = parentPath + "/" + f.ID.String()
	}

	if _, err := tx.Exec(ctx,
		`UPDATE test_folders SET path = $2 WHERE id = $1`, f.ID, matPath,
	); err != nil {
		return nil, fmt.Errorf("update path: %w", err)
	}
	f.Path = matPath

	return &f, tx.Commit(ctx)
}

// Rename updates a folder's name.
func (q *FolderQueries) Rename(ctx context.Context, id uuid.UUID, name string) error {
	_, err := q.db.Exec(ctx,
		`UPDATE test_folders SET name = $2 WHERE id = $1`, id, name,
	)
	return err
}

// Delete removes an empty folder. Returns error if it has children or test cases.
func (q *FolderQueries) Delete(ctx context.Context, id uuid.UUID) error {
	// Check for children
	var childCount int
	if err := q.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM test_folders WHERE parent_id = $1`, id,
	).Scan(&childCount); err != nil {
		return err
	}
	if childCount > 0 {
		return fmt.Errorf("cannot delete folder with sub-folders")
	}

	// Check for test cases
	var testCount int
	if err := q.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM test_cases WHERE folder_id = $1 AND is_archived = FALSE`, id,
	).Scan(&testCount); err != nil {
		return err
	}
	if testCount > 0 {
		return fmt.Errorf("cannot delete folder that contains test cases")
	}

	_, err := q.db.Exec(ctx, `DELETE FROM test_folders WHERE id = $1`, id)
	return err
}

// DeleteCascade removes a folder, all descendant folders, and every test case
// contained within (archived or not). Intended for the dashboard's explicit
// "force delete" flow — bypasses the safety guards in Delete.
func (q *FolderQueries) DeleteCascade(ctx context.Context, id uuid.UUID) error {
	ids, err := q.GetSubtreeIDs(ctx, id)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		ids = []uuid.UUID{id}
	}

	tx, err := q.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// run_items.test_case_id has no ON DELETE rule — null it out so historical
	// run records survive the cascade.
	if _, err := tx.Exec(ctx,
		`UPDATE run_items SET test_case_id = NULL
		 WHERE test_case_id IN (SELECT id FROM test_cases WHERE folder_id = ANY($1))`, ids,
	); err != nil {
		return fmt.Errorf("detach run_items: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM test_cases WHERE folder_id = ANY($1)`, ids,
	); err != nil {
		return fmt.Errorf("delete test cases: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM test_folders WHERE id = ANY($1)`, ids,
	); err != nil {
		return fmt.Errorf("delete folders: %w", err)
	}
	return tx.Commit(ctx)
}

// GetSubtreeIDs returns the IDs of a folder and all its descendants.
// Used by the runner to resolve a folder target to individual test cases.
func (q *FolderQueries) GetSubtreeIDs(ctx context.Context, folderID uuid.UUID) ([]uuid.UUID, error) {
	// Get the folder's own path first
	var basePath string
	if err := q.db.QueryRow(ctx,
		`SELECT path FROM test_folders WHERE id = $1`, folderID,
	).Scan(&basePath); err != nil {
		return nil, fmt.Errorf("get base path: %w", err)
	}

	rows, err := q.db.Query(ctx, `
		SELECT id FROM test_folders
		WHERE id = $1 OR path LIKE $2
	`, folderID, basePath+"/%")
	if err != nil {
		return nil, fmt.Errorf("get subtree: %w", err)
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// BuildTree converts a flat list of folders into a nested tree structure.
// Root folders (parent_id == nil) are at the top level.
//
// Input is expected to be ordered by path ASC (parents before children). We
// walk in reverse so that a folder's own Children slice is fully populated
// before we copy it into its parent's Children — otherwise the parent ends
// up holding a stale snapshot taken before grandchildren were attached.
func BuildTree(folders []TestFolder) []TestFolder {
	byID := make(map[uuid.UUID]*TestFolder, len(folders))
	for i := range folders {
		folders[i].Children = nil
		byID[folders[i].ID] = &folders[i]
	}

	var roots []TestFolder
	for i := len(folders) - 1; i >= 0; i-- {
		f := &folders[i]
		if f.ParentID == nil {
			continue
		}
		if parent, ok := byID[*f.ParentID]; ok {
			parent.Children = append([]TestFolder{*f}, parent.Children...)
		}
	}
	for i := range folders {
		if folders[i].ParentID == nil {
			roots = append(roots, folders[i])
		}
	}
	return roots
}
