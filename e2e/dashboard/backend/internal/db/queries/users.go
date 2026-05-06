package queries

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Models ────────────────────────────────────────────────────────────────────

type User struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	CreatedAt time.Time `json:"created_at"`
}

// ── UserQueries ───────────────────────────────────────────────────────────────

type UserQueries struct {
	db *pgxpool.Pool
}

func NewUserQueries(db *pgxpool.Pool) *UserQueries {
	return &UserQueries{db: db}
}

// Upsert creates a new user or updates their name and avatar from Google on each login.
// Returns the full user record after upsert.
func (q *UserQueries) Upsert(ctx context.Context, email, name, avatarURL string) (*User, error) {
	var u User
	err := q.db.QueryRow(ctx, `
		INSERT INTO users (email, name, avatar_url)
		VALUES ($1, $2, $3)
		ON CONFLICT (email) DO UPDATE
		  SET name       = EXCLUDED.name,
		      avatar_url = EXCLUDED.avatar_url
		RETURNING id, email, name, avatar_url, created_at
	`, email, name, avatarURL).Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}
	return &u, nil
}

// GetByID returns a user by UUID.
func (q *UserQueries) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	err := q.db.QueryRow(ctx, `
		SELECT id, email, name, avatar_url, created_at
		FROM users WHERE id = $1
	`, id).Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return &u, nil
}

// GetByEmail returns a user by email address.
func (q *UserQueries) GetByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := q.db.QueryRow(ctx, `
		SELECT id, email, name, avatar_url, created_at
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return &u, nil
}

// ListAll returns all users (platform admin use).
func (q *UserQueries) ListAll(ctx context.Context) ([]User, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, email, name, avatar_url, created_at
		FROM users
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list all users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// IsPlatformAdmin checks whether the given email is in the platform_admins table.
func (q *UserQueries) IsPlatformAdmin(ctx context.Context, email string) (bool, error) {
	var count int
	err := q.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM platform_admins WHERE email = $1`, email,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check platform admin: %w", err)
	}
	return count > 0, nil
}

// SeedPlatformAdmins inserts platform admin emails from config if not already present.
// Called on server startup — idempotent.
func (q *UserQueries) SeedPlatformAdmins(ctx context.Context, emails []string) error {
	for _, email := range emails {
		_, err := q.db.Exec(ctx, `
			INSERT INTO platform_admins (email)
			VALUES ($1)
			ON CONFLICT (email) DO NOTHING
		`, email)
		if err != nil {
			return fmt.Errorf("seed platform admin %s: %w", email, err)
		}
	}
	return nil
}

// MeResponse is the full profile returned by GET /auth/me.
type MeResponse struct {
	User  *User          `json:"user"`
	Orgs  []Organization `json:"orgs"`
	IsAdmin bool         `json:"is_platform_admin"`
}
