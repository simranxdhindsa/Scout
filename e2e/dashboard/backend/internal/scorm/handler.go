package scorm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/notifications"
	"github.com/apyhub/scout/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the top-level SCORM service wired in main.go.
type Service struct {
	phoenix *PhoenixClient
	db      *ScormDB
	store   storage.Storage
	notif   *notifications.Service
}

// NewService constructs a SCORM Service with all dependencies.
func NewService(pool *pgxpool.Pool, store storage.Storage, notif *notifications.Service, phoenixBaseURL string) *Service {
	return &Service{
		phoenix: newPhoenixClient(phoenixBaseURL),
		db:      newScormDB(pool),
		store:   store,
		notif:   notif,
	}
}

// ToggleGenerator activates or deactivates a generator by ID.
func (svc *Service) ToggleGenerator(ctx context.Context, id uuid.UUID, active bool) error {
	return svc.db.SetGeneratorActive(ctx, id, active)
}

// SeedGenerators seeds generator metadata to the DB on startup.
func (svc *Service) SeedGenerators(ctx context.Context) error {
	return SeedGenerators(ctx, svc.db.pool)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// HandleUpload handles POST /api/v1/orgs/:orgId/scorm/upload
// Accepts a multipart zip file, stores it, submits to Phoenix, starts background poller.
func (svc *Service) HandleUpload(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		jsonError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		jsonError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse multipart — max 100MB
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		jsonError(w, "failed to parse multipart form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, "missing file field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Basic validation
	if header.Size > 100<<20 {
		jsonError(w, "file too large (max 100MB)", http.StatusBadRequest)
		return
	}

	snapshotID := uuid.New()

	// Store the uploaded zip
	storageKey, storageURL, err := svc.StoreUpload(r.Context(), orgID, snapshotID, header.Filename, file)
	if err != nil {
		jsonError(w, fmt.Sprintf("storage error: %v", err), http.StatusInternalServerError)
		return
	}
	_ = storageKey

	// Reset file reader for Phoenix upload
	var uploadReader io.Reader = file
	if seeker, ok := file.(io.ReadSeeker); ok {
		_, _ = seeker.Seek(0, io.SeekStart)
	} else {
		// Re-fetch from storage if not seekable
		rc, err := svc.GetStoredFile(r.Context(), storageKey)
		if err != nil {
			jsonError(w, "failed to re-read uploaded file", http.StatusInternalServerError)
			return
		}
		defer rc.Close()
		uploadReader = rc
	}

	// Submit to Phoenix
	uploadResp, err := svc.phoenix.Upload(r.Context(), uploadReader, header.Filename)
	if err != nil {
		jsonError(w, fmt.Sprintf("phoenix upload error: %v", err), http.StatusBadGateway)
		return
	}

	// Create snapshot record
	userID := claims.UserID
	snapshot, err := svc.db.CreateSnapshot(
		r.Context(), orgID, "upload", header.Filename,
		uploadResp.JobID, header.Size, nil, &userID, uploadResp.Cached,
	)
	if err != nil {
		jsonError(w, "failed to create snapshot record", http.StatusInternalServerError)
		return
	}

	// Update storage URL
	_ = svc.db.UpdateStorageURL(r.Context(), snapshot.ID, storageURL)

	// Start background poller
	svc.StartPolling(snapshot.ID, uploadResp.JobID, orgID, &userID)

	jsonOK(w, map[string]any{
		"snapshot_id": snapshot.ID,
		"job_id":      uploadResp.JobID,
		"cached":      uploadResp.Cached,
		"status":      "pending",
	})
}

// HandleStatus handles GET /api/v1/orgs/:orgId/scorm/status/:jobId
// Proxies the Phoenix status endpoint — used by frontend polling fallback.
func (svc *Service) HandleStatus(w http.ResponseWriter, r *http.Request) {
	jobID := r.PathValue("jobId")
	if jobID == "" {
		jsonError(w, "missing jobId", http.StatusBadRequest)
		return
	}

	result, err := svc.phoenix.Status(r.Context(), jobID)
	if err != nil {
		jsonError(w, fmt.Sprintf("phoenix status error: %v", err), http.StatusBadGateway)
		return
	}

	jsonOK(w, result)
}

// HandleListSnapshots handles GET /api/v1/orgs/:orgId/scorm/snapshots
func (svc *Service) HandleListSnapshots(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		jsonError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	category := r.URL.Query().Get("category")
	status := r.URL.Query().Get("status")
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	snapshots, err := svc.db.ListSnapshots(r.Context(), orgID, category, status, limit, offset)
	if err != nil {
		jsonError(w, "failed to list snapshots", http.StatusInternalServerError)
		return
	}

	if snapshots == nil {
		snapshots = []Snapshot{}
	}

	jsonOK(w, map[string]any{
		"snapshots": snapshots,
		"limit":     limit,
		"offset":    offset,
	})
}

// HandleGetSnapshot handles GET /api/v1/orgs/:orgId/scorm/snapshots/:id
func (svc *Service) HandleGetSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		jsonError(w, "invalid snapshot id", http.StatusBadRequest)
		return
	}

	snapshot, err := svc.db.GetSnapshot(r.Context(), id)
	if err != nil {
		jsonError(w, "snapshot not found", http.StatusNotFound)
		return
	}

	jsonOK(w, snapshot)
}

// HandleDeleteSnapshot handles DELETE /api/v1/orgs/:orgId/scorm/snapshots/:id
func (svc *Service) HandleDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		jsonError(w, "invalid snapshot id", http.StatusBadRequest)
		return
	}

	if err := svc.db.SoftDeleteSnapshot(r.Context(), id); err != nil {
		jsonError(w, "failed to delete snapshot", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"status": "archived"})
}

// HandleListGenerators handles GET /api/v1/orgs/:orgId/scorm/generators
func (svc *Service) HandleListGenerators(w http.ResponseWriter, r *http.Request) {
	generators, err := svc.db.ListGenerators(r.Context(), false)
	if err != nil {
		jsonError(w, "failed to list generators", http.StatusInternalServerError)
		return
	}

	if generators == nil {
		generators = []Generator{}
	}

	jsonOK(w, map[string]any{"generators": generators})
}

// HandleGenerate handles GET /api/v1/orgs/:orgId/scorm/generate/:typeKey
// Builds the SCORM zip in-memory and streams it as a download.
func (svc *Service) HandleGenerate(w http.ResponseWriter, r *http.Request) {
	typeKey := r.PathValue("typeKey")
	if typeKey == "" {
		jsonError(w, "missing typeKey", http.StatusBadRequest)
		return
	}

	gen, err := svc.db.GetGeneratorByTypeKey(r.Context(), typeKey)
	if err != nil {
		jsonError(w, "generator not found", http.StatusNotFound)
		return
	}

	if !gen.IsActive {
		jsonError(w, "generator is not active", http.StatusForbidden)
		return
	}

	zipData, err := Build(typeKey)
	if err != nil {
		jsonError(w, fmt.Sprintf("build error: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, gen.Filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(zipData)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(zipData)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func parseIntQuery(r *http.Request, key string, fallback int) int {
	if v := r.URL.Query().Get(key); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil && n >= 0 {
			return n
		}
	}
	return fallback
}
