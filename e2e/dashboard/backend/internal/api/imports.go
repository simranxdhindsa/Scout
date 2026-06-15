package api

import (
	"archive/zip"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/specimport"
	"github.com/google/uuid"
)

// Upload + extraction guards. Specs are tiny; these caps make a malicious or
// accidentally huge archive cheap to reject (zip-bomb / memory protection).
const (
	maxZipUpload      = 25 << 20 // 25 MB compressed upload
	maxSpecFileSize   = 2 << 20  // 2 MB per extracted spec (matches single-file upload)
	maxTotalExtracted = 60 << 20 // 60 MB total uncompressed across all specs
	maxZipEntries     = 5000     // cap on entries scanned
)

type importHandler struct {
	svc Services
}

func newImportHandler(svc Services) *importHandler {
	return &importHandler{svc: svc}
}

// ImportZip handles POST /api/v1/subprojects/:spId/import-zip
//
// Accepts a multipart zip (field "file") of Playwright spec files, extracts it
// on the server, and imports every *.spec.{ts,js} / *.test.{ts,js} into the
// sub-project — recreating the zip's directory structure as folders. The import
// is additive (no prune): re-uploading adds/updates by filename, never deletes.
func (h *importHandler) ImportZip(w http.ResponseWriter, r *http.Request) {
	spID, err := uuid.Parse(r.PathValue("spId"))
	if err != nil {
		writeError(w, "invalid spId", http.StatusBadRequest)
		return
	}

	orgID, ok := orgIDForSubProject(r.Context(), h.svc.DB, spID)
	if !ok {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if !memberCheck(w, r.Context(), h.svc.DB, orgID, claims.UserID) {
		return
	}

	if err := r.ParseMultipartForm(maxZipUpload); err != nil {
		writeError(w, "failed to parse upload (max 25 MB)", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, "missing file field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		writeError(w, "file must be a .zip archive", http.StatusBadRequest)
		return
	}

	// multipart.File implements io.ReaderAt + size is known from the header, so
	// we can read the zip directly without buffering the whole thing ourselves.
	zr, err := zip.NewReader(file, header.Size)
	if err != nil {
		writeError(w, "could not read zip archive", http.StatusBadRequest)
		return
	}

	files, skipped := collectSpecsFromZip(zr)
	if len(files) == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":        "no spec files found in archive",
			"skip_reasons": skipped,
		})
		return
	}

	rootFolderID, err := h.ensureRootFolder(r, spID, claims.UserID)
	if err != nil {
		writeError(w, "failed to prepare sub-project root folder", http.StatusInternalServerError)
		return
	}
	_ = rootFolderID // ImportSpecs resolves the root itself; this guarantees one exists.

	result, err := specimport.ImportSpecs(r.Context(), h.svc.DB, h.svc.Runner.Bundler(), spID, files, specimport.Options{
		Description: "Imported from upload",
		Prune:       false,
	})
	if err != nil {
		writeError(w, "import failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Fold archive-level skips (non-spec files, oversized, zip-slip) into the result.
	result.Skipped += len(skipped)
	result.SkipReasons = append(skipped, result.SkipReasons...)

	writeJSON(w, http.StatusOK, result)
}

// ensureRootFolder returns the sub-project's root folder id, creating it if the
// sub-project has none yet (mirrors subProjectHandler.RootFolder).
func (h *importHandler) ensureRootFolder(r *http.Request, spID, userID uuid.UUID) (uuid.UUID, error) {
	var rootID uuid.UUID
	err := h.svc.DB.QueryRow(r.Context(),
		`SELECT id FROM test_folders WHERE sub_project_id = $1 AND parent_id IS NULL ORDER BY created_at ASC LIMIT 1`,
		spID,
	).Scan(&rootID)
	if err == nil {
		return rootID, nil
	}
	folderQ := queries.NewFolderQueries(h.svc.DB)
	folder, cerr := folderQ.Create(r.Context(), spID, nil, "root", userID)
	if cerr != nil {
		return uuid.UUID{}, cerr
	}
	return folder.ID, nil
}

// collectSpecsFromZip walks the archive, returning the importable spec files and
// a list of human-readable reasons for everything it skipped.
func collectSpecsFromZip(zr *zip.Reader) (files []specimport.SpecFile, skipped []string) {
	var totalExtracted int64
	for i, f := range zr.File {
		if i >= maxZipEntries {
			skipped = append(skipped, "archive truncated: too many entries")
			break
		}
		name := f.Name
		if f.FileInfo().IsDir() {
			continue
		}

		// Zip-slip / path-escape guard: reject absolute paths or any ".." segment.
		clean := path.Clean("/" + strings.ReplaceAll(name, "\\", "/"))
		rel := strings.TrimPrefix(clean, "/")
		if rel == "" || strings.HasPrefix(rel, "../") || strings.Contains(rel, "/../") {
			skipped = append(skipped, name+": unsafe path")
			continue
		}

		if !isSpecPath(rel) {
			continue // silently ignore non-spec files (helpers, configs, assets)
		}
		if f.UncompressedSize64 > maxSpecFileSize {
			skipped = append(skipped, rel+": file too large")
			continue
		}
		if totalExtracted+int64(f.UncompressedSize64) > maxTotalExtracted {
			skipped = append(skipped, rel+": total extraction limit reached")
			continue
		}

		rc, err := f.Open()
		if err != nil {
			skipped = append(skipped, rel+": could not read entry")
			continue
		}
		content, err := io.ReadAll(io.LimitReader(rc, maxSpecFileSize+1))
		rc.Close()
		if err != nil {
			skipped = append(skipped, rel+": read error")
			continue
		}
		totalExtracted += int64(len(content))
		files = append(files, specimport.SpecFile{RelPath: rel, Content: string(content)})
	}
	return files, skipped
}

// isSpecPath reports whether rel is a Playwright spec file we should import,
// excluding dependency/build dirs and dotfiles.
func isSpecPath(rel string) bool {
	lower := strings.ToLower(rel)
	for _, seg := range strings.Split(lower, "/") {
		if seg == "node_modules" || strings.HasPrefix(seg, ".") {
			return false
		}
	}
	base := path.Base(lower)
	return strings.HasSuffix(base, ".spec.ts") ||
		strings.HasSuffix(base, ".spec.js") ||
		strings.HasSuffix(base, ".test.ts") ||
		strings.HasSuffix(base, ".test.js")
}
