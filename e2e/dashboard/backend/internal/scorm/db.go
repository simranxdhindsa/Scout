package scorm

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type Snapshot struct {
	ID             uuid.UUID  `json:"id"`
	OrgID          uuid.UUID  `json:"org_id"`
	SourceType     string     `json:"source_type"`
	GeneratorID    *uuid.UUID `json:"generator_id"`
	OriginalName   string     `json:"original_name"`
	StorageURL     string     `json:"storage_url"`
	FileSizeBytes  int64      `json:"file_size_bytes"`
	JobID          string     `json:"job_id"`
	Status         string     `json:"status"`
	Cached         bool       `json:"cached"`
	ResultJSON     any        `json:"result_json"`
	CoveragePct    float64    `json:"coverage_pct"`
	SCOCount       int        `json:"sco_count"`
	LanguageCodes  []string   `json:"language_codes"`
	ErrorDetail    string     `json:"error_detail"`
	UploadedBy     *uuid.UUID `json:"uploaded_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type Generator struct {
	ID          uuid.UUID `json:"id"`
	TypeKey     string    `json:"type_key"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	Expected    string    `json:"expected"`
	Filename    string    `json:"filename"`
	IsActive    bool      `json:"is_active"`
	SortOrder   int       `json:"sort_order"`
}

// ── ScormDB ───────────────────────────────────────────────────────────────────

type ScormDB struct {
	pool *pgxpool.Pool
}

func newScormDB(pool *pgxpool.Pool) *ScormDB {
	return &ScormDB{pool: pool}
}

// ── Snapshot queries ──────────────────────────────────────────────────────────

// CreateSnapshot inserts a new pending snapshot record.
func (db *ScormDB) CreateSnapshot(ctx context.Context, orgID uuid.UUID, sourceType, originalName, jobID string, fileSizeBytes int64, generatorID *uuid.UUID, uploadedBy *uuid.UUID, cached bool) (*Snapshot, error) {
	var s Snapshot
	err := db.pool.QueryRow(ctx, `
		INSERT INTO scorm_snapshots
		  (org_id, source_type, generator_id, original_name, job_id,
		   file_size_bytes, uploaded_by, cached, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
		RETURNING id, org_id, source_type, generator_id, original_name,
		          COALESCE(storage_url,''), file_size_bytes, COALESCE(job_id,''),
		          status, cached, result_json, coverage_pct, sco_count,
		          COALESCE(language_codes, '{}'), COALESCE(error_detail,''),
		          uploaded_by, created_at, updated_at
	`, orgID, sourceType, generatorID, originalName, jobID,
		fileSizeBytes, uploadedBy, cached).Scan(
		&s.ID, &s.OrgID, &s.SourceType, &s.GeneratorID, &s.OriginalName,
		&s.StorageURL, &s.FileSizeBytes, &s.JobID,
		&s.Status, &s.Cached, &s.ResultJSON, &s.CoveragePct, &s.SCOCount,
		&s.LanguageCodes, &s.ErrorDetail, &s.UploadedBy, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create snapshot: %w", err)
	}
	return &s, nil
}

// UpdateStorageURL sets the storage_url after the file has been saved.
func (db *ScormDB) UpdateStorageURL(ctx context.Context, id uuid.UUID, storageURL string) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE scorm_snapshots SET storage_url = $2, updated_at = NOW() WHERE id = $1`,
		id, storageURL,
	)
	return err
}

// UpdateSnapshot saves the terminal result from Phoenix into the snapshot row.
func (db *ScormDB) UpdateSnapshot(ctx context.Context, id uuid.UUID, result *PhoenixResult) error {
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}

	_, err = db.pool.Exec(ctx, `
		UPDATE scorm_snapshots
		SET status         = $2,
		    result_json    = $3,
		    coverage_pct   = $4,
		    sco_count      = $5,
		    language_codes = $6,
		    error_detail   = $7,
		    updated_at     = NOW()
		WHERE id = $1
	`, id, result.Status, resultJSON, result.Coverage,
		result.SCOCount, result.Languages, result.ErrorDetail,
	)
	return err
}

// MarkFailed sets a snapshot's status to failed with an error detail message.
func (db *ScormDB) MarkFailed(ctx context.Context, id uuid.UUID, detail string) error {
	_, err := db.pool.Exec(ctx, `
		UPDATE scorm_snapshots
		SET status = 'failed', error_detail = $2, updated_at = NOW()
		WHERE id = $1
	`, id, detail)
	return err
}

// GetSnapshot returns a single snapshot by ID.
func (db *ScormDB) GetSnapshot(ctx context.Context, id uuid.UUID) (*Snapshot, error) {
	var s Snapshot
	err := db.pool.QueryRow(ctx, `
		SELECT id, org_id, source_type, generator_id, original_name,
		       COALESCE(storage_url,''), file_size_bytes, COALESCE(job_id,''),
		       status, cached, result_json, coverage_pct, sco_count,
		       COALESCE(language_codes, '{}'), COALESCE(error_detail,''),
		       uploaded_by, created_at, updated_at
		FROM scorm_snapshots WHERE id = $1
	`, id).Scan(
		&s.ID, &s.OrgID, &s.SourceType, &s.GeneratorID, &s.OriginalName,
		&s.StorageURL, &s.FileSizeBytes, &s.JobID,
		&s.Status, &s.Cached, &s.ResultJSON, &s.CoveragePct, &s.SCOCount,
		&s.LanguageCodes, &s.ErrorDetail, &s.UploadedBy, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	return &s, nil
}

// ListSnapshots returns paginated snapshots for an org with optional filters.
func (db *ScormDB) ListSnapshots(ctx context.Context, orgID uuid.UUID, category, status string, limit, offset int) ([]Snapshot, error) {
	query := `
		SELECT ss.id, ss.org_id, ss.source_type, ss.generator_id, ss.original_name,
		       COALESCE(ss.storage_url,''), ss.file_size_bytes, COALESCE(ss.job_id,''),
		       ss.status, ss.cached, ss.result_json, ss.coverage_pct, ss.sco_count,
		       COALESCE(ss.language_codes, '{}'), COALESCE(ss.error_detail,''),
		       ss.uploaded_by, ss.created_at, ss.updated_at
		FROM scorm_snapshots ss
		LEFT JOIN scorm_generators sg ON sg.id = ss.generator_id
		WHERE ss.org_id = $1
	`
	args := []any{orgID}

	if category != "" {
		args = append(args, category)
		query += fmt.Sprintf(" AND sg.category = $%d", len(args))
	}
	if status != "" {
		args = append(args, status)
		query += fmt.Sprintf(" AND ss.status = $%d", len(args))
	}

	args = append(args, limit, offset)
	query += fmt.Sprintf(" ORDER BY ss.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))

	rows, err := db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	defer rows.Close()

	var list []Snapshot
	for rows.Next() {
		var s Snapshot
		if err := rows.Scan(
			&s.ID, &s.OrgID, &s.SourceType, &s.GeneratorID, &s.OriginalName,
			&s.StorageURL, &s.FileSizeBytes, &s.JobID,
			&s.Status, &s.Cached, &s.ResultJSON, &s.CoveragePct, &s.SCOCount,
			&s.LanguageCodes, &s.ErrorDetail, &s.UploadedBy, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	return list, rows.Err()
}

// SoftDeleteSnapshot marks a snapshot as failed/archived (soft delete).
func (db *ScormDB) SoftDeleteSnapshot(ctx context.Context, id uuid.UUID) error {
	_, err := db.pool.Exec(ctx, `
		UPDATE scorm_snapshots
		SET status = 'failed', error_detail = 'archived by user', updated_at = NOW()
		WHERE id = $1
	`, id)
	return err
}

// ── Generator queries ─────────────────────────────────────────────────────────

// ListGenerators returns all active generators ordered by sort_order.
func (db *ScormDB) ListGenerators(ctx context.Context, activeOnly bool) ([]Generator, error) {
	query := `
		SELECT id, type_key, name, category, description, expected, filename, is_active, sort_order
		FROM scorm_generators
	`
	if activeOnly {
		query += " WHERE is_active = TRUE"
	}
	query += " ORDER BY sort_order ASC, name ASC"

	rows, err := db.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list generators: %w", err)
	}
	defer rows.Close()

	var list []Generator
	for rows.Next() {
		var g Generator
		if err := rows.Scan(
			&g.ID, &g.TypeKey, &g.Name, &g.Category, &g.Description,
			&g.Expected, &g.Filename, &g.IsActive, &g.SortOrder,
		); err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	return list, rows.Err()
}

// GetGeneratorByTypeKey returns a single generator by its type_key.
func (db *ScormDB) GetGeneratorByTypeKey(ctx context.Context, typeKey string) (*Generator, error) {
	var g Generator
	err := db.pool.QueryRow(ctx, `
		SELECT id, type_key, name, category, description, expected, filename, is_active, sort_order
		FROM scorm_generators WHERE type_key = $1
	`, typeKey).Scan(
		&g.ID, &g.TypeKey, &g.Name, &g.Category, &g.Description,
		&g.Expected, &g.Filename, &g.IsActive, &g.SortOrder,
	)
	if err != nil {
		return nil, fmt.Errorf("get generator: %w", err)
	}
	return &g, nil
}

// SetGeneratorActive toggles a generator's is_active flag.
func (db *ScormDB) SetGeneratorActive(ctx context.Context, id uuid.UUID, active bool) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE scorm_generators SET is_active = $2 WHERE id = $1`, id, active,
	)
	return err
}
