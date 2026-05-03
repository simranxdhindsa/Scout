package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/apyhub/scout/internal/config"
)

// Storage is the single interface all storage backends must implement.
// Swap local → S3 by changing STORAGE_DRIVER env var — zero code changes.
type Storage interface {
	// Put uploads data from r under the given key.
	// Returns the canonical storage URL/path for the object.
	Put(ctx context.Context, key string, r io.Reader, contentType string) (string, error)

	// Get retrieves an object by key. Caller must close the returned ReadCloser.
	Get(ctx context.Context, key string) (io.ReadCloser, error)

	// Delete removes an object by key. Non-existent keys are not errors.
	Delete(ctx context.Context, key string) error

	// URL returns the public (or pre-signed) URL for an object key.
	// For local storage this is a relative API path served by the backend.
	URL(key string) string
}

// New constructs the correct Storage implementation based on config.
func New(cfg *config.Config) (Storage, error) {
	switch cfg.StorageDriver {
	case "local":
		return newLocalStorage(cfg.StorageLocalDir)
	case "s3":
		return newS3Storage(cfg)
	default:
		return nil, fmt.Errorf("unknown storage driver %q — must be 'local' or 's3'", cfg.StorageDriver)
	}
}

// Key helpers — centralise key construction so all code uses the same layout.

// RunAttachmentKey returns the storage key for a run attachment file.
func RunAttachmentKey(orgID, runID, filename string) string {
	return fmt.Sprintf("orgs/%s/runs/%s/attachments/%s", orgID, runID, filename)
}

// RunReportKey returns the storage key for a run's HTML report directory.
func RunReportKey(orgID, runID string) string {
	return fmt.Sprintf("orgs/%s/runs/%s/report", orgID, runID)
}

// ScormUploadKey returns the storage key for an uploaded SCORM zip.
func ScormUploadKey(orgID, snapshotID, filename string) string {
	return fmt.Sprintf("orgs/%s/scorm/%s/%s", orgID, snapshotID, filename)
}
