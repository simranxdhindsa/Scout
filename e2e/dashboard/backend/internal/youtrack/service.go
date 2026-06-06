package youtrack

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── DB Models ─────────────────────────────────────────────────────────────────

type Integration struct {
	ID        uuid.UUID `json:"id"`
	OrgID     uuid.UUID `json:"org_id"`
	UserID    uuid.UUID `json:"user_id"`
	BaseURL   string    `json:"base_url"`
	ProjectID string    `json:"project_id"`
	BoardID   string    `json:"board_id"`
	Connected bool      `json:"connected"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TicketMapping struct {
	ID          uuid.UUID `json:"id"`
	OrgID       uuid.UUID `json:"org_id"`
	TicketID    string    `json:"ticket_id"`
	TicketTitle string    `json:"ticket_title"`
	TestCaseID  uuid.UUID `json:"test_case_id"`
	CreatedAt   time.Time `json:"created_at"`
	// Joined display field
	TestCaseName string `json:"test_case_name,omitempty"`
}

// ── Service ───────────────────────────────────────────────────────────────────

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// ── Integration CRUD ──────────────────────────────────────────────────────────

func (s *Service) Connect(ctx context.Context, orgID, userID uuid.UUID, baseURL, token, projectID, boardID string) (*Integration, error) {
	var i Integration
	err := s.db.QueryRow(ctx, `
		INSERT INTO youtrack_integrations (org_id, user_id, base_url, token, project_id, board_id, connected)
		VALUES ($1, $2, $3, $4, $5, $6, TRUE)
		ON CONFLICT (org_id, user_id) DO UPDATE
			SET base_url   = EXCLUDED.base_url,
			    token      = EXCLUDED.token,
			    project_id = EXCLUDED.project_id,
			    board_id   = EXCLUDED.board_id,
			    connected  = TRUE,
			    updated_at = NOW()
		RETURNING id, org_id, user_id, base_url, project_id, board_id, connected, created_at, updated_at
	`, orgID, userID, baseURL, token, projectID, boardID).Scan(
		&i.ID, &i.OrgID, &i.UserID, &i.BaseURL, &i.ProjectID, &i.BoardID,
		&i.Connected, &i.CreatedAt, &i.UpdatedAt)
	return &i, err
}

func (s *Service) GetForUser(ctx context.Context, orgID, userID uuid.UUID) (*Integration, error) {
	var i Integration
	err := s.db.QueryRow(ctx, `
		SELECT id, org_id, user_id, base_url, project_id, board_id, connected, created_at, updated_at
		FROM youtrack_integrations WHERE org_id = $1 AND user_id = $2
	`, orgID, userID).Scan(
		&i.ID, &i.OrgID, &i.UserID, &i.BaseURL, &i.ProjectID, &i.BoardID,
		&i.Connected, &i.CreatedAt, &i.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

func (s *Service) GetByID(ctx context.Context, id uuid.UUID) (*Integration, error) {
	var i Integration
	err := s.db.QueryRow(ctx, `
		SELECT id, org_id, user_id, base_url, project_id, board_id, connected, created_at, updated_at
		FROM youtrack_integrations WHERE id = $1
	`, id).Scan(
		&i.ID, &i.OrgID, &i.UserID, &i.BaseURL, &i.ProjectID, &i.BoardID,
		&i.Connected, &i.CreatedAt, &i.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

func (s *Service) Disconnect(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.Exec(ctx, `DELETE FROM youtrack_integrations WHERE id = $1`, id)
	return err
}

// GetClient returns an authenticated YouTrack client for the given integration.
func (s *Service) GetClient(ctx context.Context, integrationID uuid.UUID) (*Client, error) {
	var baseURL, token, projectID, boardID string
	err := s.db.QueryRow(ctx, `
		SELECT base_url, token, project_id, board_id FROM youtrack_integrations WHERE id = $1
	`, integrationID).Scan(&baseURL, &token, &projectID, &boardID)
	if err != nil {
		return nil, fmt.Errorf("integration not found: %w", err)
	}
	return NewClient(baseURL, token, projectID, boardID), nil
}

// ── Ticket Mappings ───────────────────────────────────────────────────────────

func (s *Service) ListMappings(ctx context.Context, orgID uuid.UUID) ([]TicketMapping, error) {
	rows, err := s.db.Query(ctx, `
		SELECT m.id, m.org_id, m.ticket_id, m.ticket_title, m.test_case_id, m.created_at,
		       COALESCE(tc.name, '') AS test_case_name
		FROM youtrack_ticket_mappings m
		LEFT JOIN test_cases tc ON tc.id = m.test_case_id
		WHERE m.org_id = $1
		ORDER BY m.created_at
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TicketMapping
	for rows.Next() {
		var m TicketMapping
		if err := rows.Scan(&m.ID, &m.OrgID, &m.TicketID, &m.TicketTitle,
			&m.TestCaseID, &m.CreatedAt, &m.TestCaseName); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Service) CreateMapping(ctx context.Context, orgID uuid.UUID, ticketID, ticketTitle string, testCaseID uuid.UUID) (*TicketMapping, error) {
	var m TicketMapping
	err := s.db.QueryRow(ctx, `
		INSERT INTO youtrack_ticket_mappings (org_id, ticket_id, ticket_title, test_case_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (org_id, ticket_id, test_case_id) DO UPDATE SET ticket_title = EXCLUDED.ticket_title
		RETURNING id, org_id, ticket_id, ticket_title, test_case_id, created_at
	`, orgID, ticketID, ticketTitle, testCaseID).Scan(
		&m.ID, &m.OrgID, &m.TicketID, &m.TicketTitle, &m.TestCaseID, &m.CreatedAt)
	return &m, err
}

func (s *Service) DeleteMapping(ctx context.Context, mappingID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `DELETE FROM youtrack_ticket_mappings WHERE id = $1`, mappingID)
	return err
}

// GetMappedTestCaseIDs returns distinct test_case_ids for the given ticket IDs.
func (s *Service) GetMappedTestCaseIDs(ctx context.Context, orgID uuid.UUID, ticketIDs []string) ([]uuid.UUID, error) {
	if len(ticketIDs) == 0 {
		return nil, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT test_case_id FROM youtrack_ticket_mappings
		WHERE org_id = $1 AND ticket_id = ANY($2)
	`, orgID, ticketIDs)
	if err != nil {
		return nil, err
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
	return ids, nil
}
