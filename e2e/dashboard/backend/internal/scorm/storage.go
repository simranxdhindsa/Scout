package scorm

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/apyhub/scout/internal/storage"
	"github.com/google/uuid"
)

// StoreUpload saves an uploaded SCORM zip to the configured storage backend
// (local filesystem in Phase 1, S3 in Phase 2 — zero code changes required).
// Returns the storage key and the public URL for the stored file.
func (svc *Service) StoreUpload(ctx context.Context, orgID, snapshotID uuid.UUID, filename string, r io.Reader) (key string, url string, err error) {
	// Sanitise filename — prevent path traversal in the storage key
	safe := sanitiseFilename(filename)
	if safe == "" {
		safe = "upload.zip"
	}

	key = storage.ScormUploadKey(orgID.String(), snapshotID.String(), safe)

	url, err = svc.store.Put(ctx, key, r, "application/zip")
	if err != nil {
		return "", "", fmt.Errorf("store scorm upload: %w", err)
	}

	return key, url, nil
}

// StoreGenerated saves a generated SCORM zip (from the generator) to storage.
// Returns the storage key and public URL.
func (svc *Service) StoreGenerated(ctx context.Context, orgID, snapshotID uuid.UUID, filename string, data []byte) (key string, url string, err error) {
	safe := sanitiseFilename(filename)
	if safe == "" {
		safe = "generated.zip"
	}

	key = storage.ScormUploadKey(orgID.String(), snapshotID.String(), safe)

	url, err = svc.store.Put(ctx, key, readerFromBytes(data), "application/zip")
	if err != nil {
		return "", "", fmt.Errorf("store generated scorm: %w", err)
	}

	return key, url, nil
}

// GetStoredFile retrieves a stored SCORM zip for download.
func (svc *Service) GetStoredFile(ctx context.Context, key string) (io.ReadCloser, error) {
	rc, err := svc.store.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("get stored file: %w", err)
	}
	return rc, nil
}

// sanitiseFilename strips directory separators and dangerous characters from a filename.
func sanitiseFilename(name string) string {
	// Remove any directory components
	parts := strings.Split(name, "/")
	name = parts[len(parts)-1]
	parts = strings.Split(name, "\\")
	name = parts[len(parts)-1]

	// Replace spaces and special chars
	var safe strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
			safe.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			safe.WriteRune(r)
		case r >= '0' && r <= '9':
			safe.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			safe.WriteRune(r)
		default:
			safe.WriteRune('_')
		}
	}

	result := safe.String()
	// Ensure it ends with .zip
	if !strings.HasSuffix(strings.ToLower(result), ".zip") {
		result += ".zip"
	}
	return result
}

// readerFromBytes wraps a byte slice as an io.Reader.
func readerFromBytes(b []byte) io.Reader {
	return strings.NewReader(string(b))
}
