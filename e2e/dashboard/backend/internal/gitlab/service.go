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
	"strings"
	"time"

	"github.com/apyhub/scout/internal/config"
	"github.com/apyhub/scout/internal/runner"
	"github.com/apyhub/scout/internal/specimport"
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

// AuthURL builds the GitLab OAuth consent URL. state encodes orgID + userID + returnTo.
func (s *Service) AuthURL(orgID, userID, returnTo string) string {
	statePayload := orgID + "|" + userID + "|" + returnTo
	state := base64.URLEncoding.EncodeToString([]byte(statePayload))

	params := url.Values{}
	params.Set("client_id", s.cfg.GitLabClientID)
	params.Set("redirect_uri", s.callbackURL())
	params.Set("response_type", "code")
	params.Set("state", state)

	// Build URL manually so scopes are %20-separated (some GitLab instances reject + encoding)
	base := s.baseURL() + "/oauth/authorize?" + params.Encode()
	return base + "&scope=" + strings.ReplaceAll(url.QueryEscape(oauthScopes), "+", "%20")
}

// callbackURL returns the backend OAuth callback URL.
// Must point at the backend's own externally-reachable host, not the frontend's,
// because GitLab calls this URL server-to-server during the code exchange.
func (s *Service) callbackURL() string {
	return strings.TrimRight(s.cfg.BackendURL, "/") + "/api/v1/auth/gitlab/callback"
}

// DecodeState extracts orgID, userID, and returnTo from the OAuth state parameter.
func (s *Service) DecodeState(state string) (orgID, userID, returnTo string, err error) {
	decoded, err := base64.URLEncoding.DecodeString(state)
	if err != nil {
		return "", "", "", fmt.Errorf("invalid state: %w", err)
	}
	parts := strings.SplitN(string(decoded), "|", 3)
	if len(parts) != 3 {
		return "", "", "", fmt.Errorf("malformed state")
	}
	return parts[0], parts[1], parts[2], nil
}

// ExchangeCode exchanges an auth code for a token, saves a minimal integration
// record (no repo yet), and returns it. The caller should prompt the user to
// pick a repo before the integration is fully useful.
func (s *Service) ExchangeCode(ctx context.Context, code string, orgID, userID uuid.UUID) (*Integration, error) {
	tok, err := s.exchangeToken(ctx, code)
	if err != nil {
		return nil, err
	}

	user, err := s.fetchGitLabUser(ctx, tok.AccessToken)
	if err != nil {
		return nil, err
	}

	// Store a placeholder integration (no repo set yet; repo_id=0 means unset).
	// We use upsert with repo_id=0 as a sentinel for "connected but no repo chosen".
	integ, err := s.glDB.upsert(ctx, orgID, userID,
		fmt.Sprintf("%d", user.ID), user.Username, user.AvatarURL,
		tok.AccessToken, tok.RefreshToken, tok.ExpiresAt,
		0, "", "", "main",
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
		if err := s.authedGet(ctx, integ, "/projects?"+params.Encode(), &projects); err != nil {
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

// getProject fetches a single GitLab project — used to resolve the repo's
// real default branch when the configured branch is missing or invalid.
func (s *Service) getProject(ctx context.Context, integ *Integration, repoID int64) (*GitLabProject, error) {
	var p GitLabProject
	if err := s.authedGet(ctx, integ, fmt.Sprintf("/projects/%d", repoID), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// branchExists reports whether branch resolves on the repo (404 → false).
func (s *Service) branchExists(ctx context.Context, integ *Integration, repoID int64, branch string) bool {
	if branch == "" {
		return false
	}
	var b struct {
		Name string `json:"name"`
	}
	err := s.authedGet(ctx, integ,
		fmt.Sprintf("/projects/%d/repository/branches/%s", repoID, url.PathEscape(branch)), &b)
	return err == nil
}

// UpdateSettings saves the chosen repo, branch, subfolder path and subproject for an integration.
func (s *Service) UpdateSettings(ctx context.Context, id uuid.UUID, subprojectID *uuid.UUID, repoID int64, repoName, repoURL, branch, repoPath string) error {
	return s.glDB.updateRepo(ctx, id, repoID, repoName, repoURL, branch, repoPath, subprojectID)
}

// SyncResult holds the outcome of a repo sync.
type SyncResult struct {
	Added       int      `json:"added"`
	Updated     int      `json:"updated"`
	Skipped     int      `json:"skipped"`
	Deleted     int      `json:"deleted"`
	SkipReasons []string `json:"skip_reasons,omitempty"`
}

// SyncRepo pulls *.spec.ts files from the integration's configured repo and
// imports them into the integration's configured subproject. Used by per-user
// settings flows; product flows use SyncProductRepo.
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
	return s.syncRepoWith(ctx, integ, *integ.SubProjectID, integ.RepoID, integ.Branch, integ.RepoPath)
}

// SyncProductRepo runs a sync for the given product using `caller`'s integration
// to read the repo. The repo + subproject come from product_gitlab_links.
func (s *Service) SyncProductRepo(ctx context.Context, orgID, productID, callerUserID uuid.UUID) (*SyncResult, error) {
	var (
		repoID   int64
		branch   string
		repoPath string
		spID     *uuid.UUID
	)
	err := s.db.QueryRow(ctx, `
		SELECT repo_id, branch, repo_path, sub_project_id
		FROM product_gitlab_links WHERE product_id = $1
	`, productID).Scan(&repoID, &branch, &repoPath, &spID)
	if err != nil {
		return nil, fmt.Errorf("no GitLab repo linked to this project: %w", err)
	}

	if spID == nil {
		// First sync — pick the first subproject of the product and persist it as the target.
		var picked uuid.UUID
		if err := s.db.QueryRow(ctx,
			`SELECT id FROM sub_projects WHERE product_id = $1 ORDER BY created_at ASC LIMIT 1`,
			productID,
		).Scan(&picked); err != nil {
			return nil, fmt.Errorf("project has no subproject to sync into")
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE product_gitlab_links SET sub_project_id = $2 WHERE product_id = $1`,
			productID, picked,
		); err != nil {
			return nil, fmt.Errorf("persist sync target: %w", err)
		}
		spID = &picked
	}

	integ, err := s.glDB.findByOrgUserRepo(ctx, orgID, callerUserID, repoID)
	if err != nil {
		return nil, fmt.Errorf("connect your GitLab account to this repository in Settings → Integrations before syncing")
	}

	// Resolve the branch against the repo's real default. An unset or stale
	// branch — e.g. the create-time default of "main" on a repo whose default
	// is "master" — makes the tree/file endpoints 404. Fall back to the actual
	// default branch and persist the correction so the UI and future syncs are right.
	if proj, perr := s.getProject(ctx, integ, repoID); perr == nil && proj.DefaultBranch != "" {
		if branch == "" || (branch != proj.DefaultBranch && !s.branchExists(ctx, integ, repoID, branch)) {
			log.Printf("[gitlab] branch %q invalid for repo %d; using default %q", branch, repoID, proj.DefaultBranch)
			branch = proj.DefaultBranch
			if _, uerr := s.db.Exec(ctx,
				`UPDATE product_gitlab_links SET branch = $2, updated_at = NOW() WHERE product_id = $1`,
				productID, branch,
			); uerr != nil {
				log.Printf("[gitlab] warn: persist corrected branch: %v", uerr)
			}
		}
	}

	return s.syncRepoWith(ctx, integ, *spID, repoID, branch, repoPath)
}

// syncRepoWith runs the sync using integ for auth/repo access and the explicit
// (subprojectID, repoID, branch, repoPath) as the target — independent of any
// values stored on integ.SubProjectID / integ.RepoID. Updates integ.last_synced_at on success.
func (s *Service) syncRepoWith(ctx context.Context, integ *Integration, subprojectID uuid.UUID, repoID int64, branch, repoPath string) (*SyncResult, error) {
	// Build an effective integration view for the helpers below — they read RepoID/Branch/RepoPath off the struct.
	effective := *integ
	effective.RepoID = repoID
	effective.Branch = branch
	effective.RepoPath = repoPath
	effective.SubProjectID = &subprojectID

	integ = &effective

	// List all spec files from the repo
	specPaths, err := s.listSpecFiles(ctx, integ)
	if err != nil {
		if strings.Contains(err.Error(), "returned 404") || strings.Contains(err.Error(), "not found") {
			return nil, fmt.Errorf("repository, branch %q, or subfolder %q not found on GitLab — check the project's GitLab settings: %w",
				branch, repoPath, err)
		}
		return nil, fmt.Errorf("list spec files: %w", err)
	}

	// Fetch each file and build the import set, stripping the configured
	// repo_path prefix so files import relative to the sub-project root. Fetch
	// failures are recorded as skips and merged into the final result.
	basePath := strings.Trim(integ.RepoPath, "/")
	var files []specimport.SpecFile
	var fetchSkips []string
	for _, specPath := range specPaths {
		content, err := s.fetchFileContent(ctx, integ, specPath)
		if err != nil {
			fetchSkips = append(fetchSkips, fmt.Sprintf("%s: fetch error: %v", specPath, err))
			continue
		}
		rel := specPath
		if basePath != "" {
			rel = strings.TrimPrefix(rel, basePath)
			rel = strings.TrimPrefix(rel, "/")
		}
		files = append(files, specimport.SpecFile{RelPath: rel, Content: content})
	}

	// Validate, bundle, recreate folders, upsert, and prune via the shared core.
	res, err := specimport.ImportSpecs(ctx, s.db, s.bundler, subprojectID, files, specimport.Options{
		Description: "Imported from GitLab",
		Prune:       true,
	})
	if err != nil {
		return nil, err
	}

	_ = s.glDB.updateLastSynced(ctx, integ.ID)
	return &SyncResult{
		Added:       res.Added,
		Updated:     res.Updated,
		Skipped:     res.Skipped + len(fetchSkips),
		Deleted:     res.Deleted,
		SkipReasons: append(fetchSkips, res.SkipReasons...),
	}, nil
}

// DeleteIntegration removes a GitLab integration.
func (s *Service) DeleteIntegration(ctx context.Context, id uuid.UUID) error {
	return s.glDB.delete(ctx, id)
}

// ListIntegrations returns the GitLab integrations the caller owns inside the org.
func (s *Service) ListIntegrations(ctx context.Context, orgID, userID uuid.UUID) ([]Integration, error) {
	return s.glDB.listByOrgUser(ctx, orgID, userID)
}

// GetOwnedIntegration returns an integration only if the caller owns it.
func (s *Service) GetOwnedIntegration(ctx context.Context, id, userID uuid.UUID) (*Integration, error) {
	return s.glDB.getOwnedByID(ctx, id, userID)
}

// GetIntegration returns a single integration by ID without an ownership check.
// Reserved for service-internal callers (e.g. product sync resolving auth).
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

type oauthToken struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    *time.Time
}

func (s *Service) exchangeToken(ctx context.Context, code string) (*oauthToken, error) {
	params := url.Values{}
	params.Set("client_id", s.cfg.GitLabClientID)
	params.Set("client_secret", s.cfg.GitLabClientSecret)
	params.Set("code", code)
	params.Set("grant_type", "authorization_code")
	params.Set("redirect_uri", s.callbackURL())
	return s.postToken(ctx, params)
}

// refreshAccessToken exchanges the integration's refresh_token for a new access
// token and persists the rotated credentials. Mutates integ in place.
func (s *Service) refreshAccessToken(ctx context.Context, integ *Integration) error {
	if integ.RefreshToken == "" {
		return fmt.Errorf("no refresh token stored — user must reconnect GitLab")
	}
	params := url.Values{}
	params.Set("client_id", s.cfg.GitLabClientID)
	params.Set("client_secret", s.cfg.GitLabClientSecret)
	params.Set("refresh_token", integ.RefreshToken)
	params.Set("grant_type", "refresh_token")
	params.Set("redirect_uri", s.callbackURL())

	tok, err := s.postToken(ctx, params)
	if err != nil {
		return fmt.Errorf("refresh gitlab token: %w", err)
	}
	if err := s.glDB.updateTokens(ctx, integ.ID, tok.AccessToken, tok.RefreshToken, tok.ExpiresAt); err != nil {
		return fmt.Errorf("persist refreshed token: %w", err)
	}
	integ.AccessToken = tok.AccessToken
	if tok.RefreshToken != "" {
		integ.RefreshToken = tok.RefreshToken
	}
	integ.TokenExpiresAt = tok.ExpiresAt
	return nil
}

func (s *Service) postToken(ctx context.Context, params url.Values) (*oauthToken, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.tokenURL(), strings.NewReader(params.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("post gitlab token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("gitlab token endpoint returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if result.Error != "" {
		return nil, fmt.Errorf("gitlab oauth error: %s", result.Error)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("gitlab returned empty access token")
	}
	tok := &oauthToken{AccessToken: result.AccessToken, RefreshToken: result.RefreshToken}
	if result.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
		tok.ExpiresAt = &t
	}
	return tok, nil
}

// authedGet calls gitlabGet using integ's access token, and on a 401 attempts
// a single refresh+retry. Use this for any call made on behalf of a stored
// integration; raw gitlabGet stays for the OAuth-callback path where no
// integration exists yet.
func (s *Service) authedGet(ctx context.Context, integ *Integration, endpoint string, out interface{}) error {
	err := s.gitlabGet(ctx, integ.AccessToken, endpoint, out)
	if err == nil || !isUnauthorized(err) {
		return err
	}
	if rerr := s.refreshAccessToken(ctx, integ); rerr != nil {
		return rerr
	}
	return s.gitlabGet(ctx, integ.AccessToken, endpoint, out)
}

// authedRawGet performs an authenticated GET that returns the raw response body
// (used for file content). Mirrors authedGet's refresh-on-401 behavior.
func (s *Service) authedRawGet(ctx context.Context, integ *Integration, endpoint string) ([]byte, error) {
	body, status, err := s.rawGet(ctx, integ.AccessToken, endpoint)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized {
		if rerr := s.refreshAccessToken(ctx, integ); rerr != nil {
			return nil, rerr
		}
		body, status, err = s.rawGet(ctx, integ.AccessToken, endpoint)
		if err != nil {
			return nil, err
		}
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("gitlab GET %s returned %d: %s", endpoint, status, string(body))
	}
	return body, nil
}

func (s *Service) rawGet(ctx context.Context, token, endpoint string) ([]byte, int, error) {
	u := s.apiBaseURL() + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("gitlab GET %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func isUnauthorized(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "returned 401")
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
	basePath := strings.Trim(integ.RepoPath, "/")
	for {
		endpoint := fmt.Sprintf("/projects/%d/repository/tree?recursive=true&ref=%s&per_page=100&page=%d",
			integ.RepoID, url.QueryEscape(integ.Branch), page)
		if basePath != "" {
			endpoint += "&path=" + url.QueryEscape(basePath)
		}
		var entries []repoTreeEntry
		if err := s.authedGet(ctx, integ, endpoint, &entries); err != nil {
			return nil, err
		}
		for _, e := range entries {
			if e.Type == "blob" && (strings.HasSuffix(e.Path, ".spec.ts") || strings.HasSuffix(e.Path, ".spec.js")) {
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

// ListRepoDirs returns the top-level and nested directories in a repo for the
// folder picker. repoID and branch override whatever is saved on the integration
// — needed because the project-creation flow picks a repo *before* it's been
// persisted onto the integration row.
func (s *Service) ListRepoDirs(ctx context.Context, integrationID uuid.UUID, repoID int64, branch string) ([]string, error) {
	integ, err := s.glDB.getByID(ctx, integrationID)
	if err != nil {
		return nil, err
	}
	if repoID == 0 {
		repoID = integ.RepoID
	}
	if branch == "" {
		branch = integ.Branch
	}
	if repoID == 0 {
		return nil, fmt.Errorf("no repository selected — pass repo_id or save one on the integration first")
	}
	if branch == "" {
		branch = "main"
	}

	var dirs []string
	page := 1
	for {
		endpoint := fmt.Sprintf("/projects/%d/repository/tree?recursive=true&ref=%s&per_page=100&page=%d",
			repoID, url.QueryEscape(branch), page)
		var entries []repoTreeEntry
		if err := s.authedGet(ctx, integ, endpoint, &entries); err != nil {
			return nil, err
		}
		for _, e := range entries {
			if e.Type == "tree" {
				dirs = append(dirs, e.Path)
			}
		}
		if len(entries) < 100 {
			break
		}
		page++
	}
	return dirs, nil
}

func (s *Service) fetchFileContent(ctx context.Context, integ *Integration, filePath string) (string, error) {
	encoded := url.PathEscape(filePath)
	endpoint := fmt.Sprintf("/projects/%d/repository/files/%s/raw?ref=%s",
		integ.RepoID, encoded, url.QueryEscape(integ.Branch))

	body, err := s.authedRawGet(ctx, integ, endpoint)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
