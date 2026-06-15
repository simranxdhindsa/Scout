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
	"time"

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
	Added        int      `json:"added"`
	Updated      int      `json:"updated"`
	Skipped      int      `json:"skipped"`
	Deleted      int      `json:"deleted"`
	SkipReasons  []string `json:"skip_reasons,omitempty"`
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
		repoID    int64
		branch    string
		repoPath  string
		spID      *uuid.UUID
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
		// Fallback: user may have disconnected and reconnected GitLab, creating a
		// new integration record with repo_id=0 while the product link still has the
		// old repo_id. Use any active integration for this org+user.
		integ, err = s.glDB.findByOrgAndUser(ctx, orgID, callerUserID)
		if err != nil {
			return nil, fmt.Errorf("connect your GitLab account in Settings → Integrations before syncing")
		}
		// Self-heal: only update the stale integration_id when the found integration
		// is a placeholder (repo_id=0) — i.e. the user reconnected OAuth without
		// configuring a specific repo on it. If the integration is for a different
		// specific repo, do not overwrite the product link.
		if integ.RepoID == 0 {
			_, _ = s.db.Exec(ctx,
				`UPDATE product_gitlab_links SET integration_id = $2 WHERE product_id = $1`,
				productID, integ.ID,
			)
		}
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

	folderQ := queries.NewFolderQueries(s.db)
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
	// Pre-populate folder cache by reconstructing each folder's dir-string path
	// ("auth/login") from the parent chain so existing folders are reused on
	// re-sync instead of duplicated.
	folderByID := make(map[uuid.UUID]queries.TestFolder, len(allFolders))
	for _, f := range allFolders {
		folderByID[f.ID] = f
	}
	for _, f := range allFolders {
		if f.ParentID == nil {
			continue
		}
		parts := []string{f.Name}
		cur := f
		for cur.ParentID != nil {
			p, ok := folderByID[*cur.ParentID]
			if !ok || p.ParentID == nil {
				break
			}
			parts = append([]string{p.Name}, parts...)
			cur = p
		}
		folderCache[strings.Join(parts, "/")] = f.ID
	}

	seenTestIDs := make(map[uuid.UUID]bool)
	seenFolderIDs := map[uuid.UUID]bool{rootFolderID: true}

	skip := func(result *SyncResult, file, reason string) {
		msg := fmt.Sprintf("%s: %s", file, reason)
		log.Printf("[gitlab] skip %s", msg)
		result.Skipped++
		result.SkipReasons = append(result.SkipReasons, msg)
	}

	result := &SyncResult{}
	for _, specPath := range specPaths {
		// Fetch file content
		content, err := s.fetchFileContent(ctx, integ, specPath)
		if err != nil {
			skip(result, specPath, fmt.Sprintf("fetch error: %v", err))
			continue
		}

		// For GitLab-synced files only check size and file type — not import style,
		// since repos commonly import from local fixtures instead of @playwright/test directly.
		vr := runner.ValidateTestFile(content, filepath.Base(specPath))
		if !vr.Valid {
			hasFatal := false
			for _, e := range vr.Errors {
				if strings.Contains(e.Message, "file too large") ||
					strings.Contains(e.Message, "unsupported file type") ||
					strings.Contains(e.Message, "file is empty") {
					hasFatal = true
					break
				}
			}
			if hasFatal {
				msgs := make([]string, len(vr.Errors))
				for i, e := range vr.Errors { msgs[i] = e.Message }
				skip(result, specPath, fmt.Sprintf("validation: %s", strings.Join(msgs, "; ")))
				continue
			}
		}

		// Bundle
		bundled, err := s.bundler.Bundle(content, filepath.Base(specPath))
		if err != nil {
			skip(result, specPath, fmt.Sprintf("bundle error: %v", err))
			continue
		}

		// Ensure folder hierarchy exists — strip the configured repo_path prefix
		// so files sync into root (or a relative subdir) instead of the full repo path.
		dir := path.Dir(specPath)
		if dir == "." {
			dir = ""
		}
		if basePath := strings.Trim(integ.RepoPath, "/"); basePath != "" {
			dir = strings.TrimPrefix(dir, basePath)
			dir = strings.Trim(dir, "/")
		}
		folderID, err := s.ensureFolderPath(ctx, folderQ, folderCache, *integ.SubProjectID, rootFolderID, dir)
		if err != nil {
			skip(result, specPath, fmt.Sprintf("folder error: %v", err))
			continue
		}

		// Mark the leaf folder and every intermediate as seen so the prune pass
		// below doesn't remove them.
		seenFolderIDs[folderID] = true
		built := ""
		for _, p := range strings.Split(dir, "/") {
			if p == "" {
				continue
			}
			if built == "" {
				built = p
			} else {
				built = built + "/" + p
			}
			if id, ok := folderCache[built]; ok {
				seenFolderIDs[id] = true
			}
		}

		// Check if test already exists anywhere in this subproject with this filename
		fileName := filepath.Base(specPath)
		existing, err := s.findTestByFileNameInSubProject(ctx, *integ.SubProjectID, fileName)
		if err != nil {
			skip(result, specPath, fmt.Sprintf("db lookup error: %v", err))
			continue
		}

		testName := strings.TrimSuffix(fileName, filepath.Ext(fileName))

		if existing != nil {
			seenTestIDs[existing.ID] = true
			// Move to correct folder if it ended up somewhere else (e.g. prior sync before repo_path stripping)
			if _, err := s.db.Exec(ctx, `UPDATE test_cases SET folder_id = $2 WHERE id = $1`, existing.ID, folderID); err != nil {
				skip(result, specPath, fmt.Sprintf("move folder error: %v", err))
				continue
			}
			if existing.FileContent == content {
				continue // unchanged — not a skip, just no-op
			}
			if err := s.updateTestImported(ctx, existing.ID, existing.Name, existing.Description, content, bundled); err != nil {
				skip(result, specPath, fmt.Sprintf("update error: %v", err))
				continue
			}
			result.Updated++
		} else {
			newID, err := s.createTestImported(ctx, folderID, testName, fileName, content, bundled)
			if err != nil {
				skip(result, specPath, fmt.Sprintf("create error: %v", err))
				continue
			}
			seenTestIDs[newID] = true
			result.Added++
		}
	}

	// Prune: delete tests and folders in this subproject that weren't seen in
	// the repo this sync — so the dashboard mirrors the repo instead of
	// accumulating stale entries.
	deleted, err := s.pruneUnseen(ctx, *integ.SubProjectID, seenTestIDs, seenFolderIDs)
	if err != nil {
		return nil, fmt.Errorf("prune unseen: %w", err)
	}
	result.Deleted = deleted

	_ = s.glDB.updateLastSynced(ctx, integ.ID)
	return result, nil
}

// pruneUnseen deletes non-archived tests not in seenTestIDs and folders
// (excluding root) not in seenFolderIDs for the given subproject. run_items
// referencing pruned tests are detached (set NULL) first so historical run
// records survive. Returns the total count of pruned tests + folders.
func (s *Service) pruneUnseen(ctx context.Context, spID uuid.UUID, seenTests, seenFolders map[uuid.UUID]bool) (int, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	// Collect test IDs to delete
	testRows, err := tx.Query(ctx, `
		SELECT tc.id FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		WHERE tf.sub_project_id = $1 AND tc.is_archived = FALSE
	`, spID)
	if err != nil {
		return 0, err
	}
	var testsToDelete []uuid.UUID
	for testRows.Next() {
		var id uuid.UUID
		if err := testRows.Scan(&id); err != nil {
			testRows.Close()
			return 0, err
		}
		if !seenTests[id] {
			testsToDelete = append(testsToDelete, id)
		}
	}
	testRows.Close()
	if err := testRows.Err(); err != nil {
		return 0, err
	}

	if len(testsToDelete) > 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE run_items SET test_case_id = NULL WHERE test_case_id = ANY($1)`,
			testsToDelete,
		); err != nil {
			return 0, fmt.Errorf("detach run_items: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM test_cases WHERE id = ANY($1)`, testsToDelete,
		); err != nil {
			return 0, fmt.Errorf("delete tests: %w", err)
		}
	}

	// Collect folder IDs to delete (excluding root). Cascade FKs handle nested
	// folders + remaining test_cases, but we still detach run_items for any
	// non-archived tests that may live under an unseen folder we just missed.
	folderRows, err := tx.Query(ctx, `
		SELECT id FROM test_folders
		WHERE sub_project_id = $1 AND parent_id IS NOT NULL
	`, spID)
	if err != nil {
		return 0, err
	}
	var foldersToDelete []uuid.UUID
	for folderRows.Next() {
		var id uuid.UUID
		if err := folderRows.Scan(&id); err != nil {
			folderRows.Close()
			return 0, err
		}
		if !seenFolders[id] {
			foldersToDelete = append(foldersToDelete, id)
		}
	}
	folderRows.Close()
	if err := folderRows.Err(); err != nil {
		return 0, err
	}

	if len(foldersToDelete) > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE run_items SET test_case_id = NULL
			WHERE test_case_id IN (SELECT id FROM test_cases WHERE folder_id = ANY($1))
		`, foldersToDelete); err != nil {
			return 0, fmt.Errorf("detach run_items (folders): %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM test_folders WHERE id = ANY($1)`, foldersToDelete,
		); err != nil {
			return 0, fmt.Errorf("delete folders: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(testsToDelete) + len(foldersToDelete), nil
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
func (s *Service) createTestImported(ctx context.Context, folderID uuid.UUID, name, fileName, fileContent, bundledContent string) (uuid.UUID, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
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
		return uuid.UUID{}, fmt.Errorf("insert test case: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO test_case_versions (test_case_id, version, file_content, changed_by)
		VALUES ($1, $2, $3, NULL)
	`, id, version, fileContent); err != nil {
		return uuid.UUID{}, fmt.Errorf("record version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return id, nil
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

// findTestByFileNameInSubProject searches all folders in a subproject for a test by filename.
func (s *Service) findTestByFileNameInSubProject(ctx context.Context, spID uuid.UUID, fileName string) (*existingTest, error) {
	var t existingTest
	err := s.db.QueryRow(ctx, `
		SELECT tc.id, tc.name, COALESCE(tc.description,''), tc.file_content
		FROM test_cases tc
		JOIN test_folders tf ON tf.id = tc.folder_id
		WHERE tf.sub_project_id = $1 AND tc.file_name = $2 AND tc.is_archived = FALSE
		LIMIT 1
	`, spID, fileName).Scan(&t.ID, &t.Name, &t.Description, &t.FileContent)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
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
