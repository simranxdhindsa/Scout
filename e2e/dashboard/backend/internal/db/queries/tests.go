package queries

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type TestCase struct {
	ID             uuid.UUID  `json:"id"`
	FolderID       uuid.UUID  `json:"folder_id"`
	Name           string     `json:"name"`
	Description    string     `json:"description"`
	FileName       string     `json:"file_name"`
	FileContent    string     `json:"file_content"`
	BundledContent string     `json:"bundled_content,omitempty"`
	IsArchived     bool       `json:"is_archived"`
	Version        int        `json:"version"`
	CreatedBy      *uuid.UUID `json:"created_by"`
	UpdatedBy      *uuid.UUID `json:"updated_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type TestCaseVersion struct {
	ID          uuid.UUID  `json:"id"`
	TestCaseID  uuid.UUID  `json:"test_case_id"`
	Version     int        `json:"version"`
	FileContent string     `json:"file_content"`
	ChangedBy   *uuid.UUID `json:"changed_by"`
	ChangedAt   time.Time  `json:"changed_at"`
}

type ArchiveRequest struct {
	ID            uuid.UUID  `json:"id"`
	OrgID         uuid.UUID  `json:"org_id"`
	TestCaseID    uuid.UUID  `json:"test_case_id"`
	Reason        string     `json:"reason"`
	RequestedBy   *uuid.UUID `json:"requested_by"`
	Status        string     `json:"status"`
	ReviewedBy    *uuid.UUID `json:"reviewed_by"`
	ReviewComment string     `json:"review_comment"`
	ReviewedAt    *time.Time `json:"reviewed_at"`
	CreatedAt     time.Time  `json:"created_at"`
	// Joined fields
	TestCaseName string `json:"test_case_name,omitempty"`
	RequesterName string `json:"requester_name,omitempty"`
}

// ── TestQueries ───────────────────────────────────────────────────────────────

type TestQueries struct {
	db *pgxpool.Pool
}

func NewTestQueries(db *pgxpool.Pool) *TestQueries {
	return &TestQueries{db: db}
}

// ListByFolder returns all non-archived test cases in a folder.
func (q *TestQueries) ListByFolder(ctx context.Context, folderID uuid.UUID) ([]TestCase, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, folder_id, name, description, file_name, file_content,
		       bundled_content, is_archived, version, created_by, updated_by,
		       created_at, updated_at
		FROM test_cases
		WHERE folder_id = $1 AND is_archived = FALSE
		ORDER BY name ASC
	`, folderID)
	if err != nil {
		return nil, fmt.Errorf("list tests by folder: %w", err)
	}
	defer rows.Close()

	var tests []TestCase
	for rows.Next() {
		var t TestCase
		if err := rows.Scan(
			&t.ID, &t.FolderID, &t.Name, &t.Description, &t.FileName,
			&t.FileContent, &t.BundledContent, &t.IsArchived, &t.Version,
			&t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		tests = append(tests, t)
	}
	return tests, rows.Err()
}

// GetByID returns a single test case by UUID.
func (q *TestQueries) GetByID(ctx context.Context, id uuid.UUID) (*TestCase, error) {
	var t TestCase
	err := q.db.QueryRow(ctx, `
		SELECT id, folder_id, name, description, file_name, file_content,
		       bundled_content, is_archived, version, created_by, updated_by,
		       created_at, updated_at
		FROM test_cases WHERE id = $1
	`, id).Scan(
		&t.ID, &t.FolderID, &t.Name, &t.Description, &t.FileName,
		&t.FileContent, &t.BundledContent, &t.IsArchived, &t.Version,
		&t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get test by id: %w", err)
	}
	return &t, nil
}

// Create inserts a new test case and records the first version.
func (q *TestQueries) Create(ctx context.Context, folderID uuid.UUID, name, description, fileName, fileContent, bundledContent string, createdBy uuid.UUID) (*TestCase, error) {
	tx, err := q.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var t TestCase
	err = tx.QueryRow(ctx, `
		INSERT INTO test_cases
		  (folder_id, name, description, file_name, file_content, bundled_content, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
		RETURNING id, folder_id, name, description, file_name, file_content,
		          bundled_content, is_archived, version, created_by, updated_by,
		          created_at, updated_at
	`, folderID, name, description, fileName, fileContent, bundledContent, createdBy).Scan(
		&t.ID, &t.FolderID, &t.Name, &t.Description, &t.FileName,
		&t.FileContent, &t.BundledContent, &t.IsArchived, &t.Version,
		&t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert test case: %w", err)
	}

	// Record initial version
	_, err = tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, $4)
	`, t.ID, t.Version, fileContent, createdBy)
	if err != nil {
		return nil, fmt.Errorf("record initial version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &t, nil
}

// Update replaces file content, bumps version, and records a new version row.
func (q *TestQueries) Update(ctx context.Context, id uuid.UUID, name, description, fileContent, bundledContent string, updatedBy uuid.UUID) (*TestCase, error) {
	tx, err := q.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var t TestCase
	err = tx.QueryRow(ctx, `
		UPDATE test_cases
		SET name            = $2,
		    description     = $3,
		    file_content    = $4,
		    bundled_content = $5,
		    updated_by      = $6,
		    version         = version + 1,
		    updated_at      = NOW()
		WHERE id = $1
		RETURNING id, folder_id, name, description, file_name, file_content,
		          bundled_content, is_archived, version, created_by, updated_by,
		          created_at, updated_at
	`, id, name, description, fileContent, bundledContent, updatedBy).Scan(
		&t.ID, &t.FolderID, &t.Name, &t.Description, &t.FileName,
		&t.FileContent, &t.BundledContent, &t.IsArchived, &t.Version,
		&t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update test case: %w", err)
	}

	// Record new version
	_, err = tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, $4)
	`, t.ID, t.Version, fileContent, updatedBy)
	if err != nil {
		return nil, fmt.Errorf("record version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &t, nil
}

// ListVersions returns the full version history for a test case.
func (q *TestQueries) ListVersions(ctx context.Context, testCaseID uuid.UUID) ([]TestCaseVersion, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, test_case_id, version, file_content, changed_by, changed_at
		FROM test_case_versions
		WHERE test_case_id = $1
		ORDER BY version DESC
	`, testCaseID)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()

	var versions []TestCaseVersion
	for rows.Next() {
		var v TestCaseVersion
		if err := rows.Scan(&v.ID, &v.TestCaseID, &v.Version, &v.FileContent, &v.ChangedBy, &v.ChangedAt); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

// ── Archive queue ─────────────────────────────────────────────────────────────

// CreateArchiveRequest soft-flags a test case for deletion and creates a pending request.
func (q *TestQueries) CreateArchiveRequest(ctx context.Context, orgID, testCaseID uuid.UUID, reason string, requestedBy uuid.UUID) (*ArchiveRequest, error) {
	var ar ArchiveRequest
	err := q.db.QueryRow(ctx, `
		INSERT INTO archive_requests (org_id, test_case_id, reason, requested_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id, org_id, test_case_id, reason, requested_by, status,
		          reviewed_by, review_comment, reviewed_at, created_at
	`, orgID, testCaseID, reason, requestedBy).Scan(
		&ar.ID, &ar.OrgID, &ar.TestCaseID, &ar.Reason, &ar.RequestedBy,
		&ar.Status, &ar.ReviewedBy, &ar.ReviewComment, &ar.ReviewedAt, &ar.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create archive request: %w", err)
	}
	return &ar, nil
}

// ListPendingArchiveRequests returns all pending archive requests for an org.
func (q *TestQueries) ListPendingArchiveRequests(ctx context.Context, orgID uuid.UUID) ([]ArchiveRequest, error) {
	rows, err := q.db.Query(ctx, `
		SELECT ar.id, ar.org_id, ar.test_case_id, ar.reason, ar.requested_by,
		       ar.status, ar.reviewed_by, ar.review_comment, ar.reviewed_at, ar.created_at,
		       tc.name AS test_case_name,
		       u.name  AS requester_name
		FROM archive_requests ar
		JOIN test_cases tc ON tc.id = ar.test_case_id
		LEFT JOIN users u ON u.id = ar.requested_by
		WHERE ar.org_id = $1 AND ar.status = 'pending'
		ORDER BY ar.created_at ASC
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list archive requests: %w", err)
	}
	defer rows.Close()

	var list []ArchiveRequest
	for rows.Next() {
		var ar ArchiveRequest
		if err := rows.Scan(
			&ar.ID, &ar.OrgID, &ar.TestCaseID, &ar.Reason, &ar.RequestedBy,
			&ar.Status, &ar.ReviewedBy, &ar.ReviewComment, &ar.ReviewedAt, &ar.CreatedAt,
			&ar.TestCaseName, &ar.RequesterName,
		); err != nil {
			return nil, err
		}
		list = append(list, ar)
	}
	return list, rows.Err()
}

// ApproveArchiveRequest hard-deletes the test case and marks the request approved.
func (q *TestQueries) ApproveArchiveRequest(ctx context.Context, requestID, reviewedBy uuid.UUID) error {
	tx, err := q.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Get test_case_id
	var testCaseID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT test_case_id FROM archive_requests WHERE id = $1 AND status = 'pending'`,
		requestID,
	).Scan(&testCaseID); err != nil {
		return fmt.Errorf("get archive request: %w", err)
	}

	// Hard delete the test case (cascades to versions)
	if _, err := tx.Exec(ctx, `DELETE FROM test_cases WHERE id = $1`, testCaseID); err != nil {
		return fmt.Errorf("delete test case: %w", err)
	}

	// Mark request approved
	if _, err := tx.Exec(ctx, `
		UPDATE archive_requests
		SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
		WHERE id = $1
	`, requestID, reviewedBy); err != nil {
		return fmt.Errorf("update archive request: %w", err)
	}

	return tx.Commit(ctx)
}

// RejectArchiveRequest marks the request rejected without touching the test case.
func (q *TestQueries) RejectArchiveRequest(ctx context.Context, requestID, reviewedBy uuid.UUID, comment string) error {
	_, err := q.db.Exec(ctx, `
		UPDATE archive_requests
		SET status = 'rejected', reviewed_by = $2, review_comment = $3, reviewed_at = NOW()
		WHERE id = $1 AND status = 'pending'
	`, requestID, reviewedBy, comment)
	return err
}

// GetTestsBySubProject returns all non-archived tests in a sub-project (for runner).
func (q *TestQueries) GetTestsBySubProject(ctx context.Context, subProjectID uuid.UUID) ([]TestCase, error) {
	rows, err := q.db.Query(ctx, `
		SELECT tc.id, tc.folder_id, tc.name, tc.description, tc.file_name,
		       tc.file_content, tc.bundled_content, tc.is_archived, tc.version,
		       tc.created_by, tc.updated_by, tc.created_at, tc.updated_at
		FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		WHERE tf.sub_project_id = $1 AND tc.is_archived = FALSE
		ORDER BY tc.name ASC
	`, subProjectID)
	if err != nil {
		return nil, fmt.Errorf("get tests by sub-project: %w", err)
	}
	defer rows.Close()

	var tests []TestCase
	for rows.Next() {
		var t TestCase
		if err := rows.Scan(
			&t.ID, &t.FolderID, &t.Name, &t.Description, &t.FileName,
			&t.FileContent, &t.BundledContent, &t.IsArchived, &t.Version,
			&t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		tests = append(tests, t)
	}
	return tests, rows.Err()
}
