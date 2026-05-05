package gitlab

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration represents a stored GitLab connection for an org.
type Integration struct {
	ID             uuid.UUID  `json:"id"`
	OrgID          uuid.UUID  `json:"org_id"`
	SubProjectID   *uuid.UUID `json:"subproject_id"`
	GitLabUserID   string     `json:"gitlab_user_id"`
	GitLabUsername string     `json:"gitlab_username"`
	GitLabAvatar   string     `json:"gitlab_avatar"`
	AccessToken    string     `json:"-"`
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

func (q *gitLabDB) listByOrg(ctx context.Context, orgID uuid.UUID) ([]Integration, error) {
	rows, err := q.db.Query(ctx, `
		SELECT id, org_id, subproject_id, gitlab_user_id, gitlab_username, gitlab_avatar,
		       access_token, repo_id, repo_name, repo_url, branch, repo_path, last_synced_at,
		       created_at, updated_at
		FROM gitlab_integrations
		WHERE org_id = $1
		ORDER BY created_at ASC
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list gitlab integrations: %w", err)
	}
	defer rows.Close()

	var list []Integration
	for rows.Next() {
		var i Integration
		if err := rows.Scan(
			&i.ID, &i.OrgID, &i.SubProjectID, &i.GitLabUserID, &i.GitLabUsername,
			&i.GitLabAvatar, &i.AccessToken, &i.RepoID, &i.RepoName, &i.RepoURL,
			&i.Branch, &i.RepoPath, &i.LastSyncedAt, &i.CreatedAt, &i.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, i)
	}
	return list, rows.Err()
}

func (q *gitLabDB) getByID(ctx context.Context, id uuid.UUID) (*Integration, error) {
	var i Integration
	err := q.db.QueryRow(ctx, `
		SELECT id, org_id, subproject_id, gitlab_user_id, gitlab_username, gitlab_avatar,
		       access_token, repo_id, repo_name, repo_url, branch, repo_path, last_synced_at,
		       created_at, updated_at
		FROM gitlab_integrations WHERE id = $1
	`, id).Scan(
		&i.ID, &i.OrgID, &i.SubProjectID, &i.GitLabUserID, &i.GitLabUsername,
		&i.GitLabAvatar, &i.AccessToken, &i.RepoID, &i.RepoName, &i.RepoURL,
		&i.Branch, &i.RepoPath, &i.LastSyncedAt, &i.CreatedAt, &i.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("get gitlab integration: %w", err)
	}
	return &i, nil
}

func (q *gitLabDB) upsert(ctx context.Context, orgID uuid.UUID, userID, username, avatar, accessToken string, repoID int64, repoName, repoURL, branch string) (*Integration, error) {
	var i Integration
	err := q.db.QueryRow(ctx, `
		INSERT INTO gitlab_integrations
		  (org_id, gitlab_user_id, gitlab_username, gitlab_avatar, access_token,
		   repo_id, repo_name, repo_url, branch)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (org_id, repo_id) DO UPDATE
		  SET gitlab_user_id  = EXCLUDED.gitlab_user_id,
		      gitlab_username = EXCLUDED.gitlab_username,
		      gitlab_avatar   = EXCLUDED.gitlab_avatar,
		      access_token    = EXCLUDED.access_token,
		      repo_name       = EXCLUDED.repo_name,
		      repo_url        = EXCLUDED.repo_url,
		      branch          = EXCLUDED.branch,
		      updated_at      = NOW()
		RETURNING id, org_id, subproject_id, gitlab_user_id, gitlab_username, gitlab_avatar,
		          access_token, repo_id, repo_name, repo_url, branch, repo_path, last_synced_at,
		          created_at, updated_at
	`, orgID, userID, username, avatar, accessToken, repoID, repoName, repoURL, branch).Scan(
		&i.ID, &i.OrgID, &i.SubProjectID, &i.GitLabUserID, &i.GitLabUsername,
		&i.GitLabAvatar, &i.AccessToken, &i.RepoID, &i.RepoName, &i.RepoURL,
		&i.Branch, &i.RepoPath, &i.LastSyncedAt, &i.CreatedAt, &i.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("upsert gitlab integration: %w", err)
	}
	return &i, nil
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
