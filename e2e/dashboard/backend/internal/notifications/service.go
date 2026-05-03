package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Notification mirrors the notifications DB row.
type Notification struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"user_id"`
	OrgID     *uuid.UUID `json:"org_id"`
	RunID     *uuid.UUID `json:"run_id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Message   string     `json:"message"`
	Read      bool       `json:"read"`
	Metadata  any        `json:"metadata"`
	CreatedAt time.Time  `json:"created_at"`
}

// Service handles creation and fan-out of in-app notifications.
type Service struct {
	db *pgxpool.Pool
}

// NewService creates a notifications Service.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// NotifyUser creates a notification for a single user.
func (s *Service) NotifyUser(ctx context.Context, userID uuid.UUID, orgID uuid.UUID, runID *uuid.UUID, notifType, title, message string, metadata map[string]any) error {
	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		metaJSON = []byte("{}")
	}

	_, err = s.db.Exec(ctx, `
		INSERT INTO notifications (user_id, org_id, run_id, type, title, message, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, userID, orgID, runID, notifType, title, message, metaJSON)
	if err != nil {
		return fmt.Errorf("notify user: %w", err)
	}
	return nil
}

// NotifyOrg fans out a notification to all members of an org.
func (s *Service) NotifyOrg(ctx context.Context, orgID uuid.UUID, runID *uuid.UUID, notifType, title, message string, metadata map[string]any) error {
	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		metaJSON = []byte("{}")
	}

	// Insert one notification row per org member in a single query
	_, err = s.db.Exec(ctx, `
		INSERT INTO notifications (user_id, org_id, run_id, type, title, message, metadata)
		SELECT om.user_id, $1, $2, $3, $4, $5, $6
		FROM org_members om
		WHERE om.org_id = $1
	`, orgID, runID, notifType, title, message, metaJSON)
	if err != nil {
		return fmt.Errorf("notify org: %w", err)
	}
	return nil
}

// ListForUser returns unread-first notifications for a user, paginated.
func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]Notification, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, org_id, run_id, type, title, message, read, metadata, created_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY read ASC, created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	var list []Notification
	for rows.Next() {
		var n Notification
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.OrgID, &n.RunID,
			&n.Type, &n.Title, &n.Message, &n.Read,
			&n.Metadata, &n.CreatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, n)
	}
	return list, rows.Err()
}

// MarkRead marks a single notification as read.
func (s *Service) MarkRead(ctx context.Context, notifID, userID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `
		UPDATE notifications SET read = TRUE
		WHERE id = $1 AND user_id = $2
	`, notifID, userID)
	return err
}

// MarkAllRead marks all notifications for a user as read.
func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `
		UPDATE notifications SET read = TRUE
		WHERE user_id = $1 AND read = FALSE
	`, userID)
	return err
}

// UnreadCount returns the number of unread notifications for a user.
func (s *Service) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications
		WHERE user_id = $1 AND read = FALSE
	`, userID).Scan(&count)
	return count, err
}
