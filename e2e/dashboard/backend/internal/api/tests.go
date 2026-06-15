package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/google/uuid"
)

// ── testHandler ───────────────────────────────────────────────────────────────

type testHandler struct {
	svc Services
}

func newTestHandler(svc Services) *testHandler {
	return &testHandler{svc: svc}
}

// List handles GET /api/v1/folders/:folderId/tests
func (h *testHandler) List(w http.ResponseWriter, r *http.Request) {
	folderID, err := uuid.Parse(r.PathValue("folderId"))
	if err != nil {
		writeError(w, "invalid folderId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForFolder(r.Context(), h.svc.DB, folderID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	testQ := queries.NewTestQueries(h.svc.DB)
	tests, err := testQ.ListByFolder(r.Context(), folderID)
	if err != nil {
		writeError(w, "failed to list tests", http.StatusInternalServerError)
		return
	}
	if tests == nil {
		tests = []queries.TestCase{}
	}

	// Strip bundled content from list response — only needed at run time
	for i := range tests {
		tests[i].BundledContent = ""
	}

	writeJSON(w, http.StatusOK, map[string]any{"tests": tests})
}

// Get handles GET /api/v1/tests/:testId
func (h *testHandler) Get(w http.ResponseWriter, r *http.Request) {
	testID, err := uuid.Parse(r.PathValue("testId"))
	if err != nil {
		writeError(w, "invalid testId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForTest(r.Context(), h.svc.DB, testID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claimsGet := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claimsGet.UserID) {
		return
	}

	testQ := queries.NewTestQueries(h.svc.DB)
	tc, err := testQ.GetByID(r.Context(), testID)
	if err != nil {
		writeError(w, "test not found", http.StatusNotFound)
		return
	}
	tc.BundledContent = "" // never expose bundled content via API
	writeJSON(w, http.StatusOK, tc)
}

// Upload handles POST /api/v1/folders/:folderId/tests
// Accepts multipart or JSON body with file content.
func (h *testHandler) Upload(w http.ResponseWriter, r *http.Request) {
	folderID, err := uuid.Parse(r.PathValue("folderId"))
	if err != nil {
		writeError(w, "invalid folderId", http.StatusBadRequest)
		return
	}

	orgIDUp, okUp := orgIDForFolder(r.Context(), h.svc.DB, folderID)
	if !okUp {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgIDUp, claims.UserID) {
		return
	}

	var name, description, fileName, fileContent string

	contentType := r.Header.Get("Content-Type")
	if len(contentType) >= 9 && contentType[:9] == "multipart" {
		// Multipart upload
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			writeError(w, "failed to parse form", http.StatusBadRequest)
			return
		}
		name = r.FormValue("name")
		description = r.FormValue("description")

		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, "missing file field", http.StatusBadRequest)
			return
		}
		defer file.Close()

		fileName = header.Filename
		buf := make([]byte, header.Size)
		if _, err := file.Read(buf); err != nil {
			writeError(w, "failed to read file", http.StatusInternalServerError)
			return
		}
		fileContent = string(buf)
	} else {
		// JSON upload
		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			FileName    string `json:"file_name"`
			FileContent string `json:"file_content"`
		}
		if err := decodeBody(r, &body); err != nil {
			writeError(w, "invalid body", http.StatusBadRequest)
			return
		}
		name = body.Name
		description = body.Description
		fileName = body.FileName
		fileContent = body.FileContent
	}

	if name == "" || fileName == "" || fileContent == "" {
		writeError(w, "name, file_name, and file_content are required", http.StatusBadRequest)
		return
	}

	// Validate the test file
	result := runner.ValidateTestFile(fileContent, fileName)
	if !result.Valid {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "validation failed",
			"errors": result.Errors,
		})
		return
	}

	// Bundle with esbuild
	bundler := h.svc.Runner.Bundler()
	bundled, err := bundler.Bundle(fileContent, fileName)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "typescript compilation failed",
			"detail": err.Error(),
		})
		return
	}

	testQ := queries.NewTestQueries(h.svc.DB)
	tc, err := testQ.Create(r.Context(), folderID, name, description, fileName, fileContent, bundled, claims.UserID)
	if err != nil {
		writeError(w, "failed to save test case", http.StatusInternalServerError)
		return
	}

	tc.BundledContent = ""
	writeJSON(w, http.StatusCreated, tc)
}

// Update handles PUT /api/v1/tests/:testId
func (h *testHandler) Update(w http.ResponseWriter, r *http.Request) {
	testID, err := uuid.Parse(r.PathValue("testId"))
	if err != nil {
		writeError(w, "invalid testId", http.StatusBadRequest)
		return
	}

	orgIDUpd, okUpd := orgIDForTest(r.Context(), h.svc.DB, testID)
	if !okUpd {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgIDUpd, claims.UserID) {
		return
	}

	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		FileContent string `json:"file_content"`
	}
	if err := decodeBody(r, &body); err != nil || body.FileContent == "" {
		writeError(w, "file_content is required", http.StatusBadRequest)
		return
	}

	// Get existing test for filename
	testQ := queries.NewTestQueries(h.svc.DB)
	existing, err := testQ.GetByID(r.Context(), testID)
	if err != nil {
		writeError(w, "test not found", http.StatusNotFound)
		return
	}

	// Validate
	result := runner.ValidateTestFile(body.FileContent, existing.FileName)
	if !result.Valid {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "validation failed",
			"errors": result.Errors,
		})
		return
	}

	// Bundle
	bundler := h.svc.Runner.Bundler()
	bundled, err := bundler.Bundle(body.FileContent, existing.FileName)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "typescript compilation failed",
			"detail": err.Error(),
		})
		return
	}

	tc, err := testQ.Update(r.Context(), testID, body.Name, body.Description, body.FileContent, bundled, claims.UserID)
	if err != nil {
		writeError(w, "failed to update test", http.StatusInternalServerError)
		return
	}

	tc.BundledContent = ""
	writeJSON(w, http.StatusOK, tc)
}

// Versions handles GET /api/v1/tests/:testId/versions
func (h *testHandler) Versions(w http.ResponseWriter, r *http.Request) {
	testID, err := uuid.Parse(r.PathValue("testId"))
	if err != nil {
		writeError(w, "invalid testId", http.StatusBadRequest)
		return
	}

	orgIDVer, okVer := orgIDForTest(r.Context(), h.svc.DB, testID)
	if !okVer {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claimsVer := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgIDVer, claimsVer.UserID) {
		return
	}

	testQ := queries.NewTestQueries(h.svc.DB)
	versions, err := testQ.ListVersions(r.Context(), testID)
	if err != nil {
		writeError(w, "failed to list versions", http.StatusInternalServerError)
		return
	}
	if versions == nil {
		versions = []queries.TestCaseVersion{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

// Validate handles POST /api/v1/tests/:testId/validate
// Runs syntax check on the provided content without saving.
func (h *testHandler) Validate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FileContent string `json:"file_content"`
		FileName    string `json:"file_name"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	result := runner.ValidateTestFile(body.FileContent, body.FileName)
	writeJSON(w, http.StatusOK, result)
}

// ArchiveRequest handles POST /api/v1/tests/:testId/archive-request
func (h *testHandler) ArchiveRequest(w http.ResponseWriter, r *http.Request) {
	testID, err := uuid.Parse(r.PathValue("testId"))
	if err != nil {
		writeError(w, "invalid testId", http.StatusBadRequest)
		return
	}

	orgIDArch, okArch := orgIDForTest(r.Context(), h.svc.DB, testID)
	if !okArch {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgIDArch, claims.UserID) {
		return
	}

	var body struct {
		Reason string `json:"reason"`
		OrgID  string `json:"org_id"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	orgID, err := uuid.Parse(body.OrgID)
	if err != nil {
		writeError(w, "invalid org_id", http.StatusBadRequest)
		return
	}

	testQ := queries.NewTestQueries(h.svc.DB)
	ar, err := testQ.CreateArchiveRequest(r.Context(), orgID, testID, body.Reason, claims.UserID)
	if err != nil {
		writeError(w, "failed to create archive request", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, ar)
}

// ListArchiveQueue handles GET /api/v1/orgs/:orgId/archive-queue
func (h *testHandler) ListArchiveQueue(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	testQ := queries.NewTestQueries(h.svc.DB)
	requests, err := testQ.ListPendingArchiveRequests(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to list archive queue", http.StatusInternalServerError)
		return
	}
	if requests == nil {
		requests = []queries.ArchiveRequest{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": requests})
}

// ApproveArchive handles POST /api/v1/orgs/:orgId/archive-queue/:requestId/approve
func (h *testHandler) ApproveArchive(w http.ResponseWriter, r *http.Request) {
	requestID, err := uuid.Parse(r.PathValue("requestId"))
	if err != nil {
		writeError(w, "invalid requestId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	testQ := queries.NewTestQueries(h.svc.DB)
	if err := testQ.ApproveArchiveRequest(r.Context(), requestID, claims.UserID); err != nil {
		writeError(w, "failed to approve archive request", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}

// RejectArchive handles POST /api/v1/orgs/:orgId/archive-queue/:requestId/reject
func (h *testHandler) RejectArchive(w http.ResponseWriter, r *http.Request) {
	requestID, err := uuid.Parse(r.PathValue("requestId"))
	if err != nil {
		writeError(w, "invalid requestId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		Comment string `json:"comment"`
	}
	_ = decodeBody(r, &body)

	testQ := queries.NewTestQueries(h.svc.DB)
	if err := testQ.RejectArchiveRequest(r.Context(), requestID, claims.UserID, body.Comment); err != nil {
		writeError(w, "failed to reject archive request", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}
