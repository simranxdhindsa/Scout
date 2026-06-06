package queries

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChatQueries struct {
	db *pgxpool.Pool
}

func NewChatQueries(db *pgxpool.Pool) *ChatQueries {
	return &ChatQueries{db: db}
}

// ── Models ────────────────────────────────────────────────────────────────────

type ChatSession struct {
	ID        uuid.UUID `json:"id"`
	OrgID     uuid.UUID `json:"org_id"`
	UserID    uuid.UUID `json:"user_id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ChatMessage struct {
	ID        uuid.UUID `json:"id"`
	SessionID uuid.UUID `json:"session_id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// ── Sessions ──────────────────────────────────────────────────────────────────

func (q *ChatQueries) CreateSession(ctx context.Context, orgID, userID uuid.UUID, title string) (*ChatSession, error) {
	row := q.db.QueryRow(ctx, `
		INSERT INTO ai_chat_sessions (org_id, user_id, title)
		VALUES ($1, $2, $3)
		RETURNING id, org_id, user_id, title, created_at, updated_at
	`, orgID, userID, title)
	var s ChatSession
	if err := row.Scan(&s.ID, &s.OrgID, &s.UserID, &s.Title, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return nil, err
	}
	return &s, nil
}

func (q *ChatQueries) ListSessions(ctx context.Context, orgID, userID uuid.UUID) ([]ChatSession, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, org_id, user_id, title, created_at, updated_at
		FROM ai_chat_sessions
		WHERE org_id = $1 AND user_id = $2
		ORDER BY updated_at DESC
		LIMIT 50
	`, orgID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatSession
	for rows.Next() {
		var s ChatSession
		if err := rows.Scan(&s.ID, &s.OrgID, &s.UserID, &s.Title, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

func (q *ChatQueries) GetSession(ctx context.Context, id uuid.UUID) (*ChatSession, error) {
	row := q.db.QueryRow(ctx, `
		SELECT id, org_id, user_id, title, created_at, updated_at
		FROM ai_chat_sessions WHERE id = $1
	`, id)
	var s ChatSession
	if err := row.Scan(&s.ID, &s.OrgID, &s.UserID, &s.Title, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return nil, err
	}
	return &s, nil
}

func (q *ChatQueries) UpdateSessionTitle(ctx context.Context, id uuid.UUID, title string) error {
	_, err := q.db.Exec(ctx, `
		UPDATE ai_chat_sessions SET title = $2, updated_at = NOW() WHERE id = $1
	`, id, title)
	return err
}

func (q *ChatQueries) DeleteSession(ctx context.Context, id uuid.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM ai_chat_sessions WHERE id = $1`, id)
	return err
}

// ── Messages ──────────────────────────────────────────────────────────────────

func (q *ChatQueries) AddMessage(ctx context.Context, sessionID uuid.UUID, role, content string) (*ChatMessage, error) {
	tx, err := q.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE ai_chat_sessions SET updated_at = NOW() WHERE id = $1`, sessionID); err != nil {
		return nil, err
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO ai_chat_messages (session_id, role, content)
		VALUES ($1, $2, $3)
		RETURNING id, session_id, role, content, created_at
	`, sessionID, role, content)
	var m ChatMessage
	if err := row.Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &m, nil
}

func (q *ChatQueries) ListMessages(ctx context.Context, sessionID uuid.UUID) ([]ChatMessage, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, session_id, role, content, created_at
		FROM ai_chat_messages
		WHERE session_id = $1
		ORDER BY created_at ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatMessage
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}
