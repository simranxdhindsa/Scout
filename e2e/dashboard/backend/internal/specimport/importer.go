// Package specimport holds the shared pipeline for importing Playwright spec
// files into a sub-project: validate → bundle → recreate the folder hierarchy →
// upsert test_cases (+ version history), with optional pruning of entries no
// longer present in the source. Both the GitLab sync and the zip-upload import
// route funnel through ImportSpecs so there is a single source of truth.
package specimport

import (
	"context"
	"fmt"
	"log"
	"path"
	"strings"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SpecFile is one spec to import. RelPath is the slash-separated path relative
// to the sub-project root (e.g. "auth/login.spec.ts"); its directory portion
// becomes the folder hierarchy and its base name the test's file name.
type SpecFile struct {
	RelPath string
	Content string
}

// Options tunes import behaviour for the different sources.
type Options struct {
	// Description is stored on newly created test cases (e.g. "Imported from upload").
	Description string
	// Prune, when true, deletes non-archived tests and folders in the
	// sub-project that were not part of this import — so the sub-project mirrors
	// the source. GitLab sync uses this; additive uploads do not.
	Prune bool
}

// Result summarises an import run. Shape matches the JSON the dashboard expects.
type Result struct {
	Added       int      `json:"added"`
	Updated     int      `json:"updated"`
	Skipped     int      `json:"skipped"`
	Deleted     int      `json:"deleted"`
	SkipReasons []string `json:"skip_reasons,omitempty"`
}

// ImportSpecs runs the full import pipeline for the given files into spID.
func ImportSpecs(
	ctx context.Context,
	db *pgxpool.Pool,
	bundler *runner.Bundler,
	spID uuid.UUID,
	files []SpecFile,
	opts Options,
) (*Result, error) {
	result := &Result{}

	skip := func(file, reason string) {
		msg := fmt.Sprintf("%s: %s", file, reason)
		log.Printf("[specimport] skip %s", msg)
		result.Skipped++
		result.SkipReasons = append(result.SkipReasons, msg)
	}

	folderQ := queries.NewFolderQueries(db)

	// Resolve the sub-project root folder and pre-populate a dir-path → folderID
	// cache by reconstructing each existing folder's path ("auth/login") from its
	// parent chain, so existing folders are reused instead of duplicated.
	allFolders, err := folderQ.ListBySubProject(ctx, spID)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	folderCache := make(map[string]uuid.UUID)
	var rootFolderID uuid.UUID
	for _, f := range allFolders {
		if f.ParentID == nil {
			rootFolderID = f.ID
			folderCache[""] = f.ID
			break
		}
	}
	if rootFolderID == (uuid.UUID{}) {
		return nil, fmt.Errorf("sub-project has no root folder")
	}
	folderByID := make(map[uuid.UUID]queries.TestFolder, len(allFolders))
	for _, f := range allFolders {
		folderByID[f.ID] = f
	}
	for _, f := range allFolders {
		if f.ParentID == nil {
			continue
		}
		parts := []string{f.Name}
		cur := f
		for cur.ParentID != nil {
			p, ok := folderByID[*cur.ParentID]
			if !ok || p.ParentID == nil {
				break
			}
			parts = append([]string{p.Name}, parts...)
			cur = p
		}
		folderCache[strings.Join(parts, "/")] = f.ID
	}

	seenTestIDs := make(map[uuid.UUID]bool)
	seenFolderIDs := map[uuid.UUID]bool{rootFolderID: true}

	for _, sf := range files {
		fileName := path.Base(sf.RelPath)

		// Lenient validation: only fatal problems (too large, unsupported type,
		// empty) skip a file. Import-style/lint issues are tolerated since specs
		// commonly import from local fixtures rather than @playwright/test.
		if vr := runner.ValidateTestFile(sf.Content, fileName); !vr.Valid {
			fatal := ""
			for _, e := range vr.Errors {
				if strings.Contains(e.Message, "file too large") ||
					strings.Contains(e.Message, "unsupported file type") ||
					strings.Contains(e.Message, "file is empty") {
					fatal = e.Message
					break
				}
			}
			if fatal != "" {
				skip(sf.RelPath, "validation: "+fatal)
				continue
			}
		}

		bundled, err := bundler.Bundle(sf.Content, fileName)
		if err != nil {
			skip(sf.RelPath, fmt.Sprintf("bundle error: %v", err))
			continue
		}

		dir := path.Dir(sf.RelPath)
		if dir == "." {
			dir = ""
		}
		folderID, err := ensureFolderPath(ctx, db, folderCache, spID, rootFolderID, dir)
		if err != nil {
			skip(sf.RelPath, fmt.Sprintf("folder error: %v", err))
			continue
		}

		// Mark the leaf folder and every intermediate as seen so prune keeps them.
		seenFolderIDs[folderID] = true
		built := ""
		for _, p := range strings.Split(dir, "/") {
			if p == "" {
				continue
			}
			if built == "" {
				built = p
			} else {
				built = built + "/" + p
			}
			if id, ok := folderCache[built]; ok {
				seenFolderIDs[id] = true
			}
		}

		testName := strings.TrimSuffix(fileName, path.Ext(fileName))

		existing, err := findTestByFileNameInSubProject(ctx, db, spID, fileName)
		if err != nil {
			skip(sf.RelPath, fmt.Sprintf("db lookup error: %v", err))
			continue
		}

		if existing != nil {
			seenTestIDs[existing.ID] = true
			if _, err := db.Exec(ctx, `UPDATE test_cases SET folder_id = $2 WHERE id = $1`, existing.ID, folderID); err != nil {
				skip(sf.RelPath, fmt.Sprintf("move folder error: %v", err))
				continue
			}
			if existing.FileContent == sf.Content {
				continue // unchanged — no-op, not a skip
			}
			if err := updateTestImported(ctx, db, existing.ID, sf.Content, bundled); err != nil {
				skip(sf.RelPath, fmt.Sprintf("update error: %v", err))
				continue
			}
			result.Updated++
		} else {
			newID, err := createTestImported(ctx, db, folderID, testName, fileName, sf.Content, bundled, opts.Description)
			if err != nil {
				skip(sf.RelPath, fmt.Sprintf("create error: %v", err))
				continue
			}
			seenTestIDs[newID] = true
			result.Added++
		}
	}

	if opts.Prune {
		deleted, err := pruneUnseen(ctx, db, spID, seenTestIDs, seenFolderIDs)
		if err != nil {
			return nil, fmt.Errorf("prune unseen: %w", err)
		}
		result.Deleted = deleted
	}

	return result, nil
}

// ensureFolderPath creates the folder hierarchy for a slash-separated dir path
// and returns the leaf folder ID. created_by is NULL (system import).
func ensureFolderPath(
	ctx context.Context,
	db *pgxpool.Pool,
	cache map[string]uuid.UUID,
	spID, rootID uuid.UUID,
	dirPath string,
) (uuid.UUID, error) {
	if dirPath == "" {
		return rootID, nil
	}
	if id, ok := cache[dirPath]; ok {
		return id, nil
	}

	currentID := rootID
	built := ""
	for _, part := range strings.Split(dirPath, "/") {
		if part == "" {
			continue
		}
		if built == "" {
			built = part
		} else {
			built = built + "/" + part
		}
		if id, ok := cache[built]; ok {
			currentID = id
			continue
		}

		parentID := currentID
		var newID uuid.UUID
		if err := db.QueryRow(ctx, `
			INSERT INTO test_folders (sub_project_id, parent_id, name, path, created_by)
			VALUES ($1, $2, $3, '', NULL)
			RETURNING id
		`, spID, parentID, part).Scan(&newID); err != nil {
			return uuid.UUID{}, fmt.Errorf("create folder %s: %w", built, err)
		}

		// Build and set the materialized path from the parent's path.
		var parentPath string
		_ = db.QueryRow(ctx, `SELECT path FROM test_folders WHERE id = $1`, parentID).Scan(&parentPath)
		matPath := "/" + newID.String()
		if parentPath != "" {
			matPath = parentPath + "/" + newID.String()
		}
		_, _ = db.Exec(ctx, `UPDATE test_folders SET path = $2 WHERE id = $1`, newID, matPath)

		cache[built] = newID
		currentID = newID
	}
	return currentID, nil
}

type existingTest struct {
	ID          uuid.UUID
	FileContent string
}

// findTestByFileNameInSubProject searches all folders in a sub-project for a
// non-archived test by filename.
func findTestByFileNameInSubProject(ctx context.Context, db *pgxpool.Pool, spID uuid.UUID, fileName string) (*existingTest, error) {
	var t existingTest
	err := db.QueryRow(ctx, `
		SELECT tc.id, tc.file_content
		FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		WHERE tf.sub_project_id = $1 AND tc.file_name = $2 AND tc.is_archived = FALSE
		LIMIT 1
	`, spID, fileName).Scan(&t.ID, &t.FileContent)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// createTestImported inserts a new test case (NULL created_by = system import)
// plus its initial version row.
func createTestImported(ctx context.Context, db *pgxpool.Pool, folderID uuid.UUID, name, fileName, fileContent, bundledContent, description string) (uuid.UUID, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	var version int
	if err := tx.QueryRow(ctx, `
		INSERT INTO test_cases
		  (folder_id, name, description, file_name, file_content, bundled_content, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
		RETURNING id, version
	`, folderID, name, description, fileName, fileContent, bundledContent).Scan(&id, &version); err != nil {
		return uuid.UUID{}, fmt.Errorf("insert test case: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, NULL)
	`, id, version, fileContent); err != nil {
		return uuid.UUID{}, fmt.Errorf("record version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return id, nil
}

// updateTestImported bumps an existing test case's content + version (NULL
// updated_by = system import) and appends a version row.
func updateTestImported(ctx context.Context, db *pgxpool.Pool, id uuid.UUID, fileContent, bundledContent string) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var version int
	if err := tx.QueryRow(ctx, `
		UPDATE test_cases
		SET file_content    = $2,
		    bundled_content = $3,
		    updated_by      = NULL,
		    version         = version + 1,
		    updated_at      = NOW()
		WHERE id = $1
		RETURNING version
	`, id, fileContent, bundledContent).Scan(&version); err != nil {
		return fmt.Errorf("update test case: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, NULL)
	`, id, version, fileContent); err != nil {
		return fmt.Errorf("record version: %w", err)
	}

	return tx.Commit(ctx)
}

// pruneUnseen deletes non-archived tests not in seenTests and folders (excluding
// root) not in seenFolders for the sub-project. run_items referencing pruned
// tests are detached (set NULL) first so historical run records survive. Returns
// the total count of pruned tests + folders.
func pruneUnseen(ctx context.Context, db *pgxpool.Pool, spID uuid.UUID, seenTests, seenFolders map[uuid.UUID]bool) (int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	testRows, err := tx.Query(ctx, `
		SELECT tc.id FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		WHERE tf.sub_project_id = $1 AND tc.is_archived = FALSE
	`, spID)
	if err != nil {
		return 0, err
	}
	var testsToDelete []uuid.UUID
	for testRows.Next() {
		var id uuid.UUID
		if err := testRows.Scan(&id); err != nil {
			testRows.Close()
			return 0, err
		}
		if !seenTests[id] {
			testsToDelete = append(testsToDelete, id)
		}
	}
	testRows.Close()
	if err := testRows.Err(); err != nil {
		return 0, err
	}

	if len(testsToDelete) > 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE run_items SET test_case_id = NULL WHERE test_case_id = ANY($1)`,
			testsToDelete,
		); err != nil {
			return 0, fmt.Errorf("detach run_items: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM test_cases WHERE id = ANY($1)`, testsToDelete,
		); err != nil {
			return 0, fmt.Errorf("delete tests: %w", err)
		}
	}

	folderRows, err := tx.Query(ctx, `
		SELECT id FROM test_folders
		WHERE sub_project_id = $1 AND parent_id IS NOT NULL
	`, spID)
	if err != nil {
		return 0, err
	}
	var foldersToDelete []uuid.UUID
	for folderRows.Next() {
		var id uuid.UUID
		if err := folderRows.Scan(&id); err != nil {
			folderRows.Close()
			return 0, err
		}
		if !seenFolders[id] {
			foldersToDelete = append(foldersToDelete, id)
		}
	}
	folderRows.Close()
	if err := folderRows.Err(); err != nil {
		return 0, err
	}

	if len(foldersToDelete) > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE run_items SET test_case_id = NULL
			WHERE test_case_id IN (SELECT id FROM test_cases WHERE folder_id = ANY($1))
		`, foldersToDelete); err != nil {
			return 0, fmt.Errorf("detach run_items (folders): %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM test_folders WHERE id = ANY($1)`, foldersToDelete,
		); err != nil {
			return 0, fmt.Errorf("delete folders: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(testsToDelete) + len(foldersToDelete), nil
}
