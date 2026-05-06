package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// localStorage stores files on the local filesystem under a configured data directory.
// Used in Phase 1 / development. Swap to s3Storage for production by changing config.
type localStorage struct {
	dataDir string // absolute path to root data directory, e.g. ./data
}

// newLocalStorage creates the data directory if needed and returns a localStorage.
func newLocalStorage(dataDir string) (*localStorage, error) {
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve storage dir: %w", err)
	}

	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("create storage dir %s: %w", abs, err)
	}

	return &localStorage{dataDir: abs}, nil
}

// Put writes the content of r to dataDir/key, creating parent directories as needed.
func (s *localStorage) Put(_ context.Context, key string, r io.Reader, _ string) (string, error) {
	fullPath := filepath.Join(s.dataDir, filepath.FromSlash(key))

	// Create parent directories
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return "", fmt.Errorf("create dirs for %s: %w", key, err)
	}

	f, err := os.Create(fullPath)
	if err != nil {
		return "", fmt.Errorf("create file %s: %w", key, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, r); err != nil {
		return "", fmt.Errorf("write file %s: %w", key, err)
	}

	return key, nil
}

// Get opens and returns a file by key. The caller must close the returned ReadCloser.
func (s *localStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	fullPath := filepath.Join(s.dataDir, filepath.FromSlash(key))

	f, err := os.Open(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("object not found: %s", key)
		}
		return nil, fmt.Errorf("open file %s: %w", key, err)
	}

	return f, nil
}

// Delete removes the file at key. Missing files are silently ignored.
func (s *localStorage) Delete(_ context.Context, key string) error {
	fullPath := filepath.Join(s.dataDir, filepath.FromSlash(key))

	err := os.Remove(fullPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete file %s: %w", key, err)
	}

	return nil
}

// URL returns the API-served path for a locally stored object.
// The backend's /api/v1/storage/:key route serves these files.
func (s *localStorage) URL(key string) string {
	return "/api/v1/storage/" + key
}
