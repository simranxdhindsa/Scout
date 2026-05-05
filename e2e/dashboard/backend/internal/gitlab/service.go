package gitlab

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"

	"github.com/apyhub/scout/internal/config"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/jackc/pgx/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const oauthScopes = "read_api read_repository"

// Service handles GitLab OAuth, repo reading, and test sync.
type Service struct {
	cfg     *config.Config
	db      *pgxpool.Pool
	glDB    *gitLabDB
	bundler *runner.Bundler
}

// NewService creates a GitLab service. GitLab features are disabled if client credentials are absent.
func NewService(cfg *config.Config, db *pgxpool.Pool) *Service {
	return &Service{
		cfg:     cfg,
		db:      db,
		glDB:    newDB(db),
		bundler: runner.NewBundler(),
	}
}

// IsConfigured returns true when GitLab OAuth credentials are set.
func (s *Service) IsConfigured() bool {
	return s.cfg.GitLabClientID != "" && s.cfg.GitLabClientSecret != ""
}

func (s *Service) baseURL() string    { return strings.TrimRight(s.cfg.GitLabBaseURL, "/") }
func (s *Service) apiBaseURL() string { return s.baseURL() + "/api/v4" }
func (s *Service) tokenURL() string   { return s.baseURL() + "/oauth/token" }

// ── OAuth ─────────────────────────────────────────────────────────────────────

// AuthURL builds the GitLab OAuth consent URL. state encodes orgID + returnTo.
func (s *Service) AuthURL(orgID, returnTo string) string {
	statePayload := orgID + "|" + returnTo
	state := base64.URLEncoding.EncodeToString([]byte(statePayload))

	params := url.Values{}
	params.Set("client_id", s.cfg.GitLabClientID)
	params.Set("redirect_uri", s.callbackURL())
	params.Set("response_type", "code")
	params.Set("state", state)
	params.Set("scope", oauthScopes)

	return s.baseURL() + "/oauth/authorize?" + params.Encode()
}

// callbackURL returns the backend OAuth callback URL.
func (s *Service) callbackURL() string {
	// Derive from frontend URL — replace port 3000 with 8080, or use env-configured backend URL
	backendURL := strings.Replace(s.cfg.FrontendURL, ":3000", ":8080", 1)
	return backendURL + "/api/v1/auth/gitlab/callback"
}

// DecodeState extracts orgID and returnTo from the OAuth state parameter.
func (s *Service) DecodeState(state string) (orgID, returnTo string, err error) {
	decoded, err := base64.URLEncoding.DecodeString(state)
	if err != nil {
		return "", "", fmt.Errorf("invalid state: %w", err)
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("malformed state")
	}
	return parts[0], parts[1], nil
}

// ExchangeCode exchanges an auth code for a token, saves a minimal integration
// record (no repo yet), and returns it. The caller should prompt the user to
// pick a repo before the integration is fully useful.
func (s *Service) ExchangeCode(ctx context.Context, code string, orgID uuid.UUID) (*Integration, error) {
	token, err := s.exchangeToken(ctx, code)
	if err != nil {
		return nil, err
	}

	user, err := s.fetchGitLabUser(ctx, token)
	if err != nil {
		return nil, err
	}

	// Store a placeholder integration (no repo set yet; repo_id=0 means unset).
	// We use upsert with repo_id=0 as a sentinel for "connected but no repo chosen".
	integ, err := s.glDB.upsert(ctx, orgID,
		fmt.Sprintf("%d", user.ID), user.Username, user.AvatarURL,
		token, 0, "", "", "main",
	)
	if err != nil {
		return nil, err
	}
	return integ, nil
}

// ── Repo operations ───────────────────────────────────────────────────────────

// GitLabProject is a subset of the GitLab project API response.
type GitLabProject struct {
	ID                int64  `json:"id"`
	Name              string `json:"name"`
	PathWithNamespace string `json:"path_with_namespace"`
	WebURL            string `json:"web_url"`
	DefaultBranch     string `json:"default_branch"`
}

// ListUserRepos returns the GitLab projects the user is a member of.
func (s *Service) ListUserRepos(ctx context.Context, integrationID uuid.UUID) ([]GitLabProject, error) {
	integ, err := s.glDB.getByID(ctx, integrationID)
	if err != nil {
		return nil, err
	}

	var all []GitLabProject
	page := 1
	for {
		params := url.Values{}
		params.Set("membership", "true")
		params.Set("per_page", "100")
		params.Set("page", fmt.Sprintf("%d", page))
		params.Set("order_by", "last_activity_at")

		var projects []GitLabProject
		if err := s.gitlabGet(ctx, integ.AccessToken, "/projects?"+params.Encode(), &projects); err != nil {
			return nil, err
		}
		all = append(all, projects...)
		if len(projects) < 100 {
			break
		}
		page++
	}
	return all, nil
}

// UpdateSettings saves the chosen repo and branch for an integration.
func (s *Service) UpdateSettings(ctx context.Context, id uuid.UUID, subprojectID *uuid.UUID, repoID int64, repoName, repoURL, branch string) error {
	return s.glDB.updateRepo(ctx, id, repoID, repoName, repoURL, branch, subprojectID)
}

// SyncResult holds the outcome of a repo sync.
type SyncResult struct {
	Added   int `json:"added"`
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

// SyncRepo pulls *.spec.ts files from the configured repo and imports them into Scout.
func (s *Service) SyncRepo(ctx context.Context, integrationID uuid.UUID) (*SyncResult, error) {
	integ, err := s.glDB.getByID(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	if integ.RepoID == 0 {
		return nil, fmt.Errorf("no repository configured — update the integration first")
	}
	if integ.SubProjectID == nil {
		return nil, fmt.Errorf("no subproject configured — update the integration first")
	}

	// 1. Get the root folder of the subproject
	folderQ := queries.NewFolderQueries(s.db)

	// List all spec files from the repo
	specPaths, err := s.listSpecFiles(ctx, integ)
	if err != nil {
		return nil, fmt.Errorf("list spec files: %w", err)
	}

	// Build a path → folderID cache so we create each folder only once
	folderCache := make(map[string]uuid.UUID) // dir path → folder ID

	// Resolve root folder for this subproject
	allFolders, err := folderQ.ListBySubProject(ctx, *integ.SubProjectID)
	if err != nil {
		return nil, fmt.Errorf("list folders: %w", err)
	}
	// Find or note the root (parent_id == nil)
	var rootFolderID uuid.UUID
	for _, f := range allFolders {
		if f.ParentID == nil {
			rootFolderID = f.ID
			folderCache[""] = f.ID // empty dir = root
			break
		}
	}
	if rootFolderID == (uuid.UUID{}) {
		return nil, fmt.Errorf("subproject has no root folder")
	}
	// Pre-populate folder cache from existing folders
	for _, f := range allFolders {
		folderCache[f.Path] = f.ID
	}

	result := &SyncResult{}
	for _, specPath := range specPaths {
		// Fetch file content
		content, err := s.fetchFileContent(ctx, integ, specPath)
		if err != nil {
			log.Printf("[gitlab] skip %s: fetch error: %v", specPath, err)
			result.Skipped++
			continue
		}

		// Only check that the file imports Playwright — skip forbidden-pattern
		// rules that are meant for manual uploads (hardcoded URLs, baseURL, etc.)
		vr := runner.ValidateTestFile(content, filepath.Base(specPath))
		if !vr.Valid {
			// If it only fails forbidden-pattern checks (not the Playwright import
			// check), still allow import — those rules are for manual uploads.
			onlyForbidden := true
			for _, e := range vr.Errors {
				if strings.Contains(e.Message, "must import from") ||
					strings.Contains(e.Message, "file is empty") ||
					strings.Contains(e.Message, "unsupported file type") ||
					strings.Contains(e.Message, "file too large") {
					onlyForbidden = false
					break
				}
			}
			if !onlyForbidden {
				log.Printf("[gitlab] skip %s: %v", specPath, vr.Errors)
				result.Skipped++
				continue
			}
			log.Printf("[gitlab] import %s with warnings: %v", specPath, vr.Errors)
		}

		// Bundle
		bundled, err := s.bundler.Bundle(content, filepath.Base(specPath))
		if err != nil {
			log.Printf("[gitlab] skip %s: bundle error: %v", specPath, err)
			result.Skipped++
			continue
		}

		// Ensure folder hierarchy exists
		dir := path.Dir(specPath)
		if dir == "." {
			dir = ""
		}
		folderID, err := s.ensureFolderPath(ctx, folderQ, folderCache, *integ.SubProjectID, rootFolderID, dir)
		if err != nil {
			log.Printf("[gitlab] skip %s: folder error: %v", specPath, err)
			result.Skipped++
			continue
		}

		// Check if test already exists in this folder with this filename
		fileName := filepath.Base(specPath)
		existing, err := s.findTestByFileName(ctx, folderID, fileName)
		if err != nil {
			result.Skipped++
			continue
		}

		testName := strings.TrimSuffix(fileName, filepath.Ext(fileName))

		if existing != nil {
			if existing.FileContent == content {
				continue
			}
			if err := s.updateTestImported(ctx, existing.ID, existing.Name, existing.Description, content, bundled); err != nil {
				log.Printf("[gitlab] update %s: %v", specPath, err)
				result.Skipped++
				continue
			}
			result.Updated++
		} else {
			if err := s.createTestImported(ctx, folderID, testName, fileName, content, bundled); err != nil {
				log.Printf("[gitlab] create %s: %v", specPath, err)
				result.Skipped++
				continue
			}
			result.Added++
		}
	}

	_ = s.glDB.updateLastSynced(ctx, integrationID)
	return result, nil
}

// DeleteIntegration removes a GitLab integration.
func (s *Service) DeleteIntegration(ctx context.Context, id uuid.UUID) error {
	return s.glDB.delete(ctx, id)
}

// ListIntegrations returns all GitLab integrations for an org.
func (s *Service) ListIntegrations(ctx context.Context, orgID uuid.UUID) ([]Integration, error) {
	return s.glDB.listByOrg(ctx, orgID)
}

// GetIntegration returns a single integration by ID.
func (s *Service) GetIntegration(ctx context.Context, id uuid.UUID) (*Integration, error) {
	return s.glDB.getByID(ctx, id)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type gitLabUser struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatar_url"`
}

func (s *Service) fetchGitLabUser(ctx context.Context, token string) (*gitLabUser, error) {
	var u gitLabUser
	if err := s.gitlabGet(ctx, token, "/user", &u); err != nil {
		return nil, fmt.Errorf("fetch gitlab user: %w", err)
	}
	return &u, nil
}

func (s *Service) exchangeToken(ctx context.Context, code string) (string, error) {
	params := url.Values{}
	params.Set("client_id", s.cfg.GitLabClientID)
	params.Set("client_secret", s.cfg.GitLabClientSecret)
	params.Set("code", code)
	params.Set("grant_type", "authorization_code")
	params.Set("redirect_uri", s.callbackURL())

	resp, err := http.PostForm(s.tokenURL(), params)
	if err != nil {
		return "", fmt.Errorf("exchange gitlab token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("gitlab token exchange returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}
	if result.Error != "" {
		return "", fmt.Errorf("gitlab oauth error: %s", result.Error)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("gitlab returned empty access token")
	}
	return result.AccessToken, nil
}

func (s *Service) gitlabGet(ctx context.Context, token, endpoint string, out interface{}) error {
	u := s.apiBaseURL() + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("gitlab GET %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("not found: %s", endpoint)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("gitlab GET %s returned %d: %s", endpoint, resp.StatusCode, body)
	}

	return json.NewDecoder(resp.Body).Decode(out)
}

type repoTreeEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"` // "blob" or "tree"
	Path string `json:"path"`
}

func (s *Service) listSpecFiles(ctx context.Context, integ *Integration) ([]string, error) {
	var all []string
	page := 1
	for {
		endpoint := fmt.Sprintf("/projects/%d/repository/tree?recursive=true&ref=%s&per_page=100&page=%d",
			integ.RepoID, url.QueryEscape(integ.Branch), page)
		var entries []repoTreeEntry
		if err := s.gitlabGet(ctx, integ.AccessToken, endpoint, &entries); err != nil {
			return nil, err
		}
		for _, e := range entries {
			if e.Type == "blob" && strings.HasSuffix(e.Path, ".spec.ts") {
				all = append(all, e.Path)
			}
		}
		if len(entries) < 100 {
			break
		}
		page++
	}
	return all, nil
}

func (s *Service) fetchFileContent(ctx context.Context, integ *Integration, filePath string) (string, error) {
	encoded := url.PathEscape(filePath)
	endpoint := fmt.Sprintf("/projects/%d/repository/files/%s/raw?ref=%s",
		integ.RepoID, encoded, url.QueryEscape(integ.Branch))

	u := s.apiBaseURL() + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+integ.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch file %s returned %d", filePath, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// ensureFolderPath creates the folder hierarchy for a given slash-separated dir path
// and returns the leaf folder ID. created_by is NULL (system import).
func (s *Service) ensureFolderPath(
	ctx context.Context,
	folderQ *queries.FolderQueries,
	cache map[string]uuid.UUID,
	spID, rootID uuid.UUID,
	dirPath string,
) (uuid.UUID, error) {
	if dirPath == "" {
		return rootID, nil
	}
	if id, ok := cache[dirPath]; ok {
		return id, nil
	}

	parts := strings.Split(dirPath, "/")
	currentID := rootID
	built := ""
	for _, part := range parts {
		if part == "" {
			continue
		}
		if built == "" {
			built = part
		} else {
			built = built + "/" + part
		}

		if id, ok := cache[built]; ok {
			currentID = id
			continue
		}

		// Create folder with NULL created_by (system import)
		parentID := currentID
		var f queries.TestFolder
		err := s.db.QueryRow(ctx, `
			WITH inserted AS (
				INSERT INTO test_folders (sub_project_id, parent_id, name, path, created_by)
				VALUES ($1, $2, $3, '', NULL)
				RETURNING id, sub_project_id, parent_id, name, path, created_by, created_at
			),
			parent_path AS (
				SELECT path FROM test_folders WHERE id = $2
			)
			SELECT i.id, i.sub_project_id, i.parent_id, i.name, i.path, i.created_by, i.created_at
			FROM inserted i
		`, spID, parentID, part).Scan(
			&f.ID, &f.SubProjectID, &f.ParentID, &f.Name, &f.Path, &f.CreatedBy, &f.CreatedAt,
		)
		if err != nil {
			return uuid.UUID{}, fmt.Errorf("create folder %s: %w", built, err)
		}

		// Build and set the materialized path
		var parentPath string
		_ = s.db.QueryRow(ctx, `SELECT path FROM test_folders WHERE id = $1`, parentID).Scan(&parentPath)
		var matPath string
		if parentPath == "" {
			matPath = "/" + f.ID.String()
		} else {
			matPath = parentPath + "/" + f.ID.String()
		}
		_, _ = s.db.Exec(ctx, `UPDATE test_folders SET path = $2 WHERE id = $1`, f.ID, matPath)

		cache[built] = f.ID
		currentID = f.ID
	}
	return currentID, nil
}

// createTestImported inserts a new test case with NULL created_by (GitLab system import).
func (s *Service) createTestImported(ctx context.Context, folderID uuid.UUID, name, fileName, fileContent, bundledContent string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var id uuid.UUID
	var version int
	if err := tx.QueryRow(ctx, `
		INSERT INTO test_cases
		  (folder_id, name, description, file_name, file_content, bundled_content, created_by, updated_by)
		VALUES ($1, $2, 'Imported from GitLab', $3, $4, $5, NULL, NULL)
		RETURNING id, version
	`, folderID, name, fileName, fileContent, bundledContent).Scan(&id, &version); err != nil {
		return fmt.Errorf("insert test case: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, NULL)
	`, id, version, fileContent); err != nil {
		return fmt.Errorf("record version: %w", err)
	}

	return tx.Commit(ctx)
}

// updateTestImported updates an existing test case with NULL updated_by (GitLab system import).
func (s *Service) updateTestImported(ctx context.Context, id uuid.UUID, name, description, fileContent, bundledContent string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var version int
	if err := tx.QueryRow(ctx, `
		UPDATE test_cases
		SET file_content    = $2,
		    bundled_content = $3,
		    updated_by      = NULL,
		    version         = version + 1,
		    updated_at      = NOW()
		WHERE id = $1
		RETURNING version
	`, id, fileContent, bundledContent).Scan(&version); err != nil {
		return fmt.Errorf("update test case: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, NULL)
	`, id, version, fileContent); err != nil {
		return fmt.Errorf("record version: %w", err)
	}

	return tx.Commit(ctx)
}

type existingTest struct {
	ID          uuid.UUID
	Name        string
	Description string
	FileContent string
}

func (s *Service) findTestByFileName(ctx context.Context, folderID uuid.UUID, fileName string) (*existingTest, error) {
	var t existingTest
	err := s.db.QueryRow(ctx, `
		SELECT id, name, COALESCE(description,''), file_content
		FROM test_cases
		WHERE folder_id = $1 AND file_name = $2 AND is_archived = FALSE
		LIMIT 1
	`, folderID, fileName).Scan(&t.ID, &t.Name, &t.Description, &t.FileContent)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}
