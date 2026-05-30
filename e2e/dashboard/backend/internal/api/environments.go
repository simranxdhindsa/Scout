package api

import (
	"net/http"
	"time"

	"github.com/apyhub/scout/internal/auth"
	"github.com/google/uuid"
)

// ── Models ────────────────────────────────────────────────────────────────────

type Environment struct {
	ID        uuid.UUID  `json:"id"`
	OrgID     uuid.UUID  `json:"org_id"`
	Name      string     `json:"name"`
	Label     string     `json:"label"`
	BaseURL   string     `json:"base_url"`
	Username  string     `json:"username"`
	Password  string     `json:"password"`
	CreatedBy *uuid.UUID `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
}

type SubProjectEnvURL struct {
	ID            uuid.UUID `json:"id"`
	SubProjectID  uuid.UUID `json:"sub_project_id"`
	EnvironmentID uuid.UUID `json:"environment_id"`
	BaseURL       string    `json:"base_url"`
	// Joined
	EnvName string `json:"env_name,omitempty"`
}

// ── environmentHandler ────────────────────────────────────────────────────────

type environmentHandler struct {
	svc Services
}

func newEnvironmentHandler(svc Services) *environmentHandler {
	return &environmentHandler{svc: svc}
}

// List handles GET /api/v1/orgs/:orgId/environments
func (h *environmentHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	rows, err := h.svc.DB.Query(r.Context(), `
		SELECT id, org_id, name, COALESCE(label,''), COALESCE(base_url,''),
		       COALESCE(username,''), COALESCE(password,''), created_by, created_at
		FROM environments WHERE org_id = $1 ORDER BY created_at ASC
	`, orgID)
	if err != nil {
		writeError(w, "failed to list environments", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var envs []Environment
	for rows.Next() {
		var e Environment
		if err := rows.Scan(&e.ID, &e.OrgID, &e.Name, &e.Label, &e.BaseURL,
			&e.Username, &e.Password, &e.CreatedBy, &e.CreatedAt); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		envs = append(envs, e)
	}
	if envs == nil {
		envs = []Environment{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"environments": envs})
}

// Create handles POST /api/v1/orgs/:orgId/environments
func (h *environmentHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Name     string `json:"name"`
		Label    string `json:"label"`
		BaseURL  string `json:"base_url"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	var e Environment
	err = h.svc.DB.QueryRow(r.Context(), `
		INSERT INTO environments (org_id, name, label, base_url, username, password, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, org_id, name, COALESCE(label,''), COALESCE(base_url,''),
		          COALESCE(username,''), COALESCE(password,''), created_by, created_at
	`, orgID, body.Name, body.Label, body.BaseURL, body.Username, body.Password, claims.UserID).Scan(
		&e.ID, &e.OrgID, &e.Name, &e.Label, &e.BaseURL, &e.Username, &e.Password, &e.CreatedBy, &e.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to create environment (name may be taken)", http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

// Update handles PUT /api/v1/orgs/:orgId/environments/:envId
func (h *environmentHandler) Update(w http.ResponseWriter, r *http.Request) {
	envID, err := uuid.Parse(r.PathValue("envId"))
	if err != nil {
		writeError(w, "invalid envId", http.StatusBadRequest)
		return
	}

	var body struct {
		Name     string `json:"name"`
		Label    string `json:"label"`
		BaseURL  string `json:"base_url"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeBody(r, &body); err != nil || body.Name == "" {
		writeError(w, "name is required", http.StatusBadRequest)
		return
	}

	var e Environment
	err = h.svc.DB.QueryRow(r.Context(), `
		UPDATE environments
		SET name = $2, label = $3, base_url = $4, username = $5, password = $6
		WHERE id = $1
		RETURNING id, org_id, name, COALESCE(label,''), COALESCE(base_url,''),
		          COALESCE(username,''), COALESCE(password,''), created_by, created_at
	`, envID, body.Name, body.Label, body.BaseURL, body.Username, body.Password).Scan(
		&e.ID, &e.OrgID, &e.Name, &e.Label, &e.BaseURL, &e.Username, &e.Password, &e.CreatedBy, &e.CreatedAt,
	)
	if err != nil {
		writeError(w, "failed to update environment", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// Delete handles DELETE /api/v1/orgs/:orgId/environments/:envId
func (h *environmentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	envID, err := uuid.Parse(r.PathValue("envId"))
	if err != nil {
		writeError(w, "invalid envId", http.StatusBadRequest)
		return
	}

	// Guard: reject if any active runs are using this environment
	var activeCount int
	_ = h.svc.DB.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM test_runs
		WHERE environment_id = $1 AND status IN ('queued','running')
	`, envID).Scan(&activeCount)

	if activeCount > 0 {
		writeError(w, "cannot delete environment with active runs", http.StatusConflict)
		return
	}

	if _, err := h.svc.DB.Exec(r.Context(),
		`DELETE FROM environments WHERE id = $1`, envID,
	); err != nil {
		writeError(w, "failed to delete environment", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListEnvURLs handles GET /api/v1/subprojects/:spId/env-urls
func (h *environmentHandler) ListEnvURLs(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	rows, err := h.svc.DB.Query(r.Context(), `
		SELECT seu.id, seu.sub_project_id, seu.environment_id, seu.base_url,
		       e.name AS env_name
		FROM subproject_env_urls seu
		JOIN environments e ON e.id = seu.environment_id
		WHERE seu.sub_project_id = $1
		ORDER BY e.name ASC
	`, spID)
	if err != nil {
		writeError(w, "failed to list env URLs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var urls []SubProjectEnvURL
	for rows.Next() {
		var u SubProjectEnvURL
		if err := rows.Scan(&u.ID, &u.SubProjectID, &u.EnvironmentID, &u.BaseURL, &u.EnvName); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		urls = append(urls, u)
	}
	if urls == nil {
		urls = []SubProjectEnvURL{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"env_urls": urls})
}

// SetEnvURL handles PUT /api/v1/subprojects/:spId/env-urls
// Upserts the base URL for a specific environment override.
func (h *environmentHandler) SetEnvURL(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	var body struct {
		EnvironmentID string `json:"environment_id"`
		BaseURL       string `json:"base_url"`
	}
	if err := decodeBody(r, &body); err != nil || body.EnvironmentID == "" || body.BaseURL == "" {
		writeError(w, "environment_id and base_url are required", http.StatusBadRequest)
		return
	}

	envID, err := uuid.Parse(body.EnvironmentID)
	if err != nil {
		writeError(w, "invalid environment_id", http.StatusBadRequest)
		return
	}

	var u SubProjectEnvURL
	err = h.svc.DB.QueryRow(r.Context(), `
		INSERT INTO subproject_env_urls (sub_project_id, environment_id, base_url)
		VALUES ($1, $2, $3)
		ON CONFLICT (sub_project_id, environment_id)
		DO UPDATE SET base_url = EXCLUDED.base_url
		RETURNING id, sub_project_id, environment_id, base_url
	`, spID, envID, body.BaseURL).Scan(
		&u.ID, &u.SubProjectID, &u.EnvironmentID, &u.BaseURL,
	)
	if err != nil {
		writeError(w, "failed to set env URL", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, u)
}
