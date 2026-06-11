package gitlab

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration represents a stored GitLab connection owned by a single user
// inside an organisation.
type Integration struct {
	ID             uuid.UUID  `json:"id"`
	OrgID          uuid.UUID  `json:"org_id"`
	UserID         uuid.UUID  `json:"user_id"`
	SubProjectID   *uuid.UUID `json:"subproject_id"`
	GitLabUserID   string     `json:"gitlab_user_id"`
	GitLabUsername string     `json:"gitlab_username"`
	GitLabAvatar   string     `json:"gitlab_avatar"`
	AccessToken    string     `json:"-"`
	RefreshToken   string     `json:"-"`
	TokenExpiresAt *time.Time `json:"-"`
	RepoID         int64      `json:"repo_id"`
	RepoName       string     `json:"repo_name"`
	RepoURL        string     `json:"repo_url"`
	Branch         string     `json:"branch"`
	RepoPath       string     `json:"repo_path"`
	LastSyncedAt   *time.Time `json:"last_synced_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type gitLabDB struct {
	db *pgxpool.Pool
}

func newDB(db *pgxpool.Pool) *gitLabDB {
	return &gitLabDB{db: db}
}

const integrationCols = `id, org_id, user_id, subproject_id, gitlab_user_id, gitlab_username, gitlab_avatar,
	       access_token, refresh_token, token_expires_at,
	       repo_id, repo_name, repo_url, branch, repo_path, last_synced_at,
	       created_at, updated_at`

func scanIntegration(scanner interface {
	Scan(...any) error
}) (*Integration, error) {
	var i Integration
	var refresh *string
	if err := scanner.Scan(
		&i.ID, &i.OrgID, &i.UserID, &i.SubProjectID, &i.GitLabUserID, &i.GitLabUsername,
		&i.GitLabAvatar, &i.AccessToken, &refresh, &i.TokenExpiresAt,
		&i.RepoID, &i.RepoName, &i.RepoURL,
		&i.Branch, &i.RepoPath, &i.LastSyncedAt, &i.CreatedAt, &i.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if refresh != nil {
		i.RefreshToken = *refresh
	}
	return &i, nil
}

func (q *gitLabDB) listByOrgUser(ctx context.Context, orgID, userID uuid.UUID) ([]Integration, error) {
	rows, err := q.db.Query(ctx, `
		SELECT `+integrationCols+`
		FROM gitlab_integrations
		WHERE org_id = $1 AND user_id = $2
		ORDER BY created_at ASC
	`, orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("list gitlab integrations: %w", err)
	}
	defer rows.Close()

	var list []Integration
	for rows.Next() {
		i, err := scanIntegration(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, *i)
	}
	return list, rows.Err()
}

func (q *gitLabDB) getByID(ctx context.Context, id uuid.UUID) (*Integration, error) {
	i, err := scanIntegration(q.db.QueryRow(ctx, `
		SELECT `+integrationCols+` FROM gitlab_integrations WHERE id = $1
	`, id))
	if err != nil {
		return nil, fmt.Errorf("get gitlab integration: %w", err)
	}
	return i, nil
}

// getOwnedByID returns an integration only if it belongs to the given user.
// Returns pgx.ErrNoRows otherwise — handlers should translate that to 404/403.
func (q *gitLabDB) getOwnedByID(ctx context.Context, id, userID uuid.UUID) (*Integration, error) {
	i, err := scanIntegration(q.db.QueryRow(ctx, `
		SELECT `+integrationCols+` FROM gitlab_integrations WHERE id = $1 AND user_id = $2
	`, id, userID))
	if err != nil {
		return nil, fmt.Errorf("get gitlab integration: %w", err)
	}
	return i, nil
}

// findByOrgUserRepo locates the caller's integration for a specific repo so a
// product sync can resolve "use whoever is running it" auth.
func (q *gitLabDB) findByOrgUserRepo(ctx context.Context, orgID, userID uuid.UUID, repoID int64) (*Integration, error) {
	i, err := scanIntegration(q.db.QueryRow(ctx, `
		SELECT `+integrationCols+`
		FROM gitlab_integrations
		WHERE org_id = $1 AND user_id = $2 AND repo_id = $3
	`, orgID, userID, repoID))
	if err != nil {
		return nil, err
	}
	return i, nil
}

// findByOrgAndUser returns any active integration for the caller in this org.
// Used as a fallback for sync when the product link's repo_id doesn't match
// the integration record (e.g. after the user disconnects and reconnects GitLab).
func (q *gitLabDB) findByOrgAndUser(ctx context.Context, orgID, userID uuid.UUID) (*Integration, error) {
	i, err := scanIntegration(q.db.QueryRow(ctx, `
		SELECT `+integrationCols+`
		FROM gitlab_integrations
		WHERE org_id = $1 AND user_id = $2
		ORDER BY updated_at DESC
		LIMIT 1
	`, orgID, userID))
	if err != nil {
		return nil, err
	}
	return i, nil
}

func (q *gitLabDB) upsert(ctx context.Context, orgID, userID uuid.UUID, gitlabUserID, username, avatar, accessToken, refreshToken string, expiresAt *time.Time, repoID int64, repoName, repoURL, branch string) (*Integration, error) {
	var refresh *string
	if refreshToken != "" {
		refresh = &refreshToken
	}
	i, err := scanIntegration(q.db.QueryRow(ctx, `
		INSERT INTO gitlab_integrations
		  (org_id, user_id, gitlab_user_id, gitlab_username, gitlab_avatar, access_token,
		   refresh_token, token_expires_at,
		   repo_id, repo_name, repo_url, branch)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (org_id, user_id, repo_id) DO UPDATE
		  SET gitlab_user_id    = EXCLUDED.gitlab_user_id,
		      gitlab_username   = EXCLUDED.gitlab_username,
		      gitlab_avatar     = EXCLUDED.gitlab_avatar,
		      access_token      = EXCLUDED.access_token,
		      refresh_token     = EXCLUDED.refresh_token,
		      token_expires_at  = EXCLUDED.token_expires_at,
		      repo_name         = EXCLUDED.repo_name,
		      repo_url          = EXCLUDED.repo_url,
		      branch            = EXCLUDED.branch,
		      updated_at        = NOW()
		RETURNING `+integrationCols+`
	`, orgID, userID, gitlabUserID, username, avatar, accessToken, refresh, expiresAt, repoID, repoName, repoURL, branch))
	if err != nil {
		return nil, fmt.Errorf("upsert gitlab integration: %w", err)
	}
	return i, nil
}

func (q *gitLabDB) updateTokens(ctx context.Context, id uuid.UUID, accessToken, refreshToken string, expiresAt *time.Time) error {
	var refresh *string
	if refreshToken != "" {
		refresh = &refreshToken
	}
	_, err := q.db.Exec(ctx, `
		UPDATE gitlab_integrations
		SET access_token = $2, refresh_token = $3, token_expires_at = $4, updated_at = NOW()
		WHERE id = $1
	`, id, accessToken, refresh, expiresAt)
	return err
}

func (q *gitLabDB) updateSettings(ctx context.Context, id uuid.UUID, subprojectID *uuid.UUID, branch string) error {
	_, err := q.db.Exec(ctx, `
		UPDATE gitlab_integrations
		SET subproject_id = $2, branch = $3, updated_at = NOW()
		WHERE id = $1
	`, id, subprojectID, branch)
	return err
}

func (q *gitLabDB) updateRepo(ctx context.Context, id uuid.UUID, repoID int64, repoName, repoURL, branch, repoPath string, subprojectID *uuid.UUID) error {
	_, err := q.db.Exec(ctx, `
		UPDATE gitlab_integrations
		SET repo_id = $2, repo_name = $3, repo_url = $4, branch = $5,
		    repo_path = $6, subproject_id = $7, updated_at = NOW()
		WHERE id = $1
	`, id, repoID, repoName, repoURL, branch, repoPath, subprojectID)
	return err
}

func (q *gitLabDB) updateLastSynced(ctx context.Context, id uuid.UUID) error {
	_, err := q.db.Exec(ctx, `
		UPDATE gitlab_integrations SET last_synced_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, id)
	return err
}

func (q *gitLabDB) delete(ctx context.Context, id uuid.UUID) error {
	_, err := q.db.Exec(ctx, `DELETE FROM gitlab_integrations WHERE id = $1`, id)
	return err
}
