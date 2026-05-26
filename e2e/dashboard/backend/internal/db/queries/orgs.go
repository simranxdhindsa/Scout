package queries

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type Organization struct {
	ID        uuid.UUID         `json:"id"`
	Name      string            `json:"name"`
	Slug      string            `json:"slug"`
	Theme     map[string]string `json:"theme"`
	IsActive  bool              `json:"is_active"`
	CreatedAt time.Time         `json:"created_at"`
}

type OrgMember struct {
	ID        uuid.UUID `json:"id"`
	OrgID     uuid.UUID `json:"org_id"`
	UserID    uuid.UUID `json:"user_id"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	// Joined fields
	UserName   string `json:"user_name,omitempty"`
	UserEmail  string `json:"user_email,omitempty"`
	AvatarURL  string `json:"avatar_url,omitempty"`
}

type ProjectAccess struct {
	ID              uuid.UUID `json:"id"`
	OrgMemberID     uuid.UUID `json:"org_member_id"`
	SubProjectID    uuid.UUID `json:"sub_project_id"`
	CanWrite        bool      `json:"can_write"`
	CanRequestDelete bool     `json:"can_request_delete"`
}

// ── OrgQueries ────────────────────────────────────────────────────────────────

type OrgQueries struct {
	db *pgxpool.Pool
}

func NewOrgQueries(db *pgxpool.Pool) *OrgQueries {
	return &OrgQueries{db: db}
}

// ListForUser returns all active organizations a user belongs to.
func (q *OrgQueries) ListForUser(ctx context.Context, userID uuid.UUID) ([]Organization, error) {
	rows, err := q.db.Query(ctx, `
		SELECT o.id, o.name, o.slug, o.theme, o.is_active, o.created_at
		FROM organizations o
		JOIN org_members om ON om.org_id = o.id
		WHERE om.user_id = $1 AND o.is_active = TRUE
		ORDER BY o.name ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list orgs for user: %w", err)
	}
	defer rows.Close()

	var orgs []Organization
	for rows.Next() {
		var o Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt); err != nil {
			return nil, err
		}
		orgs = append(orgs, o)
	}
	return orgs, rows.Err()
}

// ListAllForUser returns every organization a user belongs to, including inactive ones.
func (q *OrgQueries) ListAllForUser(ctx context.Context, userID uuid.UUID) ([]Organization, error) {
	rows, err := q.db.Query(ctx, `
		SELECT o.id, o.name, o.slug, o.theme, o.is_active, o.created_at
		FROM organizations o
		JOIN org_members om ON om.org_id = o.id
		WHERE om.user_id = $1
		ORDER BY o.is_active DESC, o.name ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list all orgs for user: %w", err)
	}
	defer rows.Close()

	var orgs []Organization
	for rows.Next() {
		var o Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt); err != nil {
			return nil, err
		}
		orgs = append(orgs, o)
	}
	return orgs, rows.Err()
}

// ListAll returns all organizations (platform admin use).
func (q *OrgQueries) ListAll(ctx context.Context) ([]Organization, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, name, slug, theme, is_active, created_at
		FROM organizations
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list all orgs: %w", err)
	}
	defer rows.Close()

	var orgs []Organization
	for rows.Next() {
		var o Organization
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt); err != nil {
			return nil, err
		}
		orgs = append(orgs, o)
	}
	return orgs, rows.Err()
}

// GetByID returns a single organization by UUID.
func (q *OrgQueries) GetByID(ctx context.Context, id uuid.UUID) (*Organization, error) {
	var o Organization
	err := q.db.QueryRow(ctx, `
		SELECT id, name, slug, theme, is_active, created_at
		FROM organizations WHERE id = $1
	`, id).Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get org by id: %w", err)
	}
	return &o, nil
}

// GetBySlug returns a single organization by slug.
func (q *OrgQueries) GetBySlug(ctx context.Context, slug string) (*Organization, error) {
	var o Organization
	err := q.db.QueryRow(ctx, `
		SELECT id, name, slug, theme, is_active, created_at
		FROM organizations WHERE slug = $1
	`, slug).Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get org by slug: %w", err)
	}
	return &o, nil
}

// Create inserts a new organization and returns it.
func (q *OrgQueries) Create(ctx context.Context, name, slug string) (*Organization, error) {
	var o Organization
	err := q.db.QueryRow(ctx, `
		INSERT INTO organizations (name, slug)
		VALUES ($1, $2)
		RETURNING id, name, slug, theme, is_active, created_at
	`, name, slug).Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create org: %w", err)
	}
	return &o, nil
}

// Update modifies org name, slug, theme, or active status.
func (q *OrgQueries) Update(ctx context.Context, id uuid.UUID, name, slug string, isActive bool, theme map[string]string) (*Organization, error) {
	var o Organization
	err := q.db.QueryRow(ctx, `
		UPDATE organizations
		SET name = $2, slug = $3, is_active = $4, theme = $5
		WHERE id = $1
		RETURNING id, name, slug, theme, is_active, created_at
	`, id, name, slug, isActive, theme).Scan(&o.ID, &o.Name, &o.Slug, &o.Theme, &o.IsActive, &o.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("update org: %w", err)
	}
	return &o, nil
}

// ── Member queries ─────────────────────────────────────────────────────────────

// ListMembers returns all members of an org with their user profile joined.
func (q *OrgQueries) ListMembers(ctx context.Context, orgID uuid.UUID) ([]OrgMember, error) {
	rows, err := q.db.Query(ctx, `
		SELECT om.id, om.org_id, om.user_id, om.role, om.created_at,
		       u.name, u.email, u.avatar_url
		FROM org_members om
		JOIN users u ON u.id = om.user_id
		WHERE om.org_id = $1
		ORDER BY om.created_at ASC
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	defer rows.Close()

	var members []OrgMember
	for rows.Next() {
		var m OrgMember
		if err := rows.Scan(
			&m.ID, &m.OrgID, &m.UserID, &m.Role, &m.CreatedAt,
			&m.UserName, &m.UserEmail, &m.AvatarURL,
		); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// AddMember adds a user to an org with the given role.
func (q *OrgQueries) AddMember(ctx context.Context, orgID, userID uuid.UUID, role string) (*OrgMember, error) {
	var m OrgMember
	err := q.db.QueryRow(ctx, `
		INSERT INTO org_members (org_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
		RETURNING id, org_id, user_id, role, created_at
	`, orgID, userID, role).Scan(&m.ID, &m.OrgID, &m.UserID, &m.Role, &m.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("add member: %w", err)
	}
	return &m, nil
}

// UpdateMemberRole changes a member's role.
func (q *OrgQueries) UpdateMemberRole(ctx context.Context, memberID uuid.UUID, role string) error {
	_, err := q.db.Exec(ctx,
		`UPDATE org_members SET role = $2 WHERE id = $1`, memberID, role,
	)
	return err
}

// RemoveMember deletes a member from an org.
func (q *OrgQueries) RemoveMember(ctx context.Context, memberID uuid.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM org_members WHERE id = $1`, memberID)
	return err
}

// GetMemberID returns the org_members.id for a given org + user pair.
func (q *OrgQueries) GetMemberID(ctx context.Context, orgID, userID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.db.QueryRow(ctx,
		`SELECT id FROM org_members WHERE org_id = $1 AND user_id = $2`, orgID, userID,
	).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("get member id: %w", err)
	}
	return id, nil
}

// ── Project access queries ─────────────────────────────────────────────────────

// SetProjectAccess upserts project-level access for a member.
func (q *OrgQueries) SetProjectAccess(ctx context.Context, orgMemberID, subProjectID uuid.UUID, canWrite, canRequestDelete bool) error {
	_, err := q.db.Exec(ctx, `
		INSERT INTO project_access (org_member_id, sub_project_id, can_write, can_request_delete)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (org_member_id, sub_project_id)
		DO UPDATE SET can_write = EXCLUDED.can_write,
		              can_request_delete = EXCLUDED.can_request_delete
	`, orgMemberID, subProjectID, canWrite, canRequestDelete)
	return err
}

// GetProjectAccess returns access flags for a member on a sub-project.
func (q *OrgQueries) GetProjectAccess(ctx context.Context, orgMemberID, subProjectID uuid.UUID) (*ProjectAccess, error) {
	var a ProjectAccess
	err := q.db.QueryRow(ctx, `
		SELECT id, org_member_id, sub_project_id, can_write, can_request_delete
		FROM project_access
		WHERE org_member_id = $1 AND sub_project_id = $2
	`, orgMemberID, subProjectID).Scan(
		&a.ID, &a.OrgMemberID, &a.SubProjectID, &a.CanWrite, &a.CanRequestDelete,
	)
	if err != nil {
		return nil, fmt.Errorf("get project access: %w", err)
	}
	return &a, nil
}

// ListProjectAccessForMember returns all sub-project access rows for a member.
func (q *OrgQueries) ListProjectAccessForMember(ctx context.Context, orgMemberID uuid.UUID) ([]ProjectAccess, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, org_member_id, sub_project_id, can_write, can_request_delete
		FROM project_access WHERE org_member_id = $1
	`, orgMemberID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ProjectAccess
	for rows.Next() {
		var a ProjectAccess
		if err := rows.Scan(&a.ID, &a.OrgMemberID, &a.SubProjectID, &a.CanWrite, &a.CanRequestDelete); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}
