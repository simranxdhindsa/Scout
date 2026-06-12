package api

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// orgIDForSubProject returns the org_id for a given sub_project row.
// sub_projects has no direct org_id column — it joins through products.
func orgIDForSubProject(ctx context.Context, db *pgxpool.Pool, spID uuid.UUID) (uuid.UUID, bool) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `
		SELECT p.org_id FROM sub_projects sp
		JOIN products p ON p.id = sp.product_id
		WHERE sp.id = $1`, spID).Scan(&id)
	return id, err == nil
}

// orgIDForFolder resolves org_id by walking folder → sub_project → product.
func orgIDForFolder(ctx context.Context, db *pgxpool.Pool, folderID uuid.UUID) (uuid.UUID, bool) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `
		SELECT p.org_id FROM test_folders f
		JOIN sub_projects sp ON sp.id = f.sub_project_id
		JOIN products p ON p.id = sp.product_id
		WHERE f.id = $1`, folderID).Scan(&id)
	return id, err == nil
}

// orgIDForTest resolves org_id by walking test_case → folder → sub_project → product.
func orgIDForTest(ctx context.Context, db *pgxpool.Pool, testID uuid.UUID) (uuid.UUID, bool) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `
		SELECT p.org_id FROM test_cases tc
		JOIN test_folders f ON f.id = tc.folder_id
		JOIN sub_projects sp ON sp.id = f.sub_project_id
		JOIN products p ON p.id = sp.product_id
		WHERE tc.id = $1`, testID).Scan(&id)
	return id, err == nil
}

// orgIDForRun returns the org_id for a given test_run row.
func orgIDForRun(ctx context.Context, db *pgxpool.Pool, runID uuid.UUID) (uuid.UUID, bool) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `SELECT org_id FROM test_runs WHERE id = $1`, runID).Scan(&id)
	return id, err == nil
}

// memberCheck verifies the user is an active member of the org.
// Writes HTTP 403 and returns false if the check fails.
func memberCheck(w http.ResponseWriter, ctx context.Context, db *pgxpool.Pool, orgID, userID uuid.UUID) bool {
	var role string
	err := db.QueryRow(ctx, `
		SELECT om.role FROM org_members om
		JOIN organizations o ON o.id = om.org_id
		WHERE o.id = $1 AND om.user_id = $2 AND o.is_active = TRUE`,
		orgID, userID).Scan(&role)
	if err != nil {
		writeError(w, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}
