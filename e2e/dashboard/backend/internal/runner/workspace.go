package runner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

const workspaceBase = "/tmp"

// Workspace represents a temporary directory created for a single test run.
// It is created before execution and deleted immediately after.
type Workspace struct {
	RunID uuid.UUID
	Dir   string // e.g. /tmp/scout-run-<runID>
}

// NewWorkspace creates the temp directory for a run.
func NewWorkspace(runID uuid.UUID) (*Workspace, error) {
	dir := filepath.Join(workspaceBase, fmt.Sprintf("scout-run-%s", runID.String()))

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create workspace dir: %w", err)
	}

	return &Workspace{RunID: runID, Dir: dir}, nil
}

// WriteTestFile writes a bundled test file into the workspace directory.
// Returns the absolute path to the written file.
func (w *Workspace) WriteTestFile(filename, content string) (string, error) {
	// Sanitise filename — strip any directory traversal
	safe := filepath.Base(filename)
	if safe == "" || safe == "." {
		safe = "test.js"
	}
	// Ensure .js extension for playwright
	if filepath.Ext(safe) == ".ts" {
		safe = safe[:len(safe)-3] + ".js"
	}

	dest := filepath.Join(w.Dir, safe)
	if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write test file %s: %w", safe, err)
	}

	return dest, nil
}

// AuthStatePath returns the path where the generated login setup saves the
// authenticated session (storageState) for the rest of the run to reuse.
func (w *Workspace) AuthStatePath() string {
	return filepath.Join(w.Dir, ".auth", "user.json")
}

// WriteAuthSetup writes the generated login setup spec into the workspace and
// returns its absolute path. The .auth dir is created up-front so the setup can
// save storageState into it.
func (w *Workspace) WriteAuthSetup(content string) (string, error) {
	if err := os.MkdirAll(filepath.Join(w.Dir, ".auth"), 0o755); err != nil {
		return "", fmt.Errorf("create .auth dir: %w", err)
	}
	dest := filepath.Join(w.Dir, "auth.setup.js")
	if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write auth setup: %w", err)
	}
	return dest, nil
}

// WriteConfig writes the generated playwright.config.ts into the workspace.
func (w *Workspace) WriteConfig(content string) (string, error) {
	dest := filepath.Join(w.Dir, "playwright.config.ts")
	if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write playwright config: %w", err)
	}
	return dest, nil
}

// ResultsPath returns the path where the Playwright JSON reporter writes its output.
func (w *Workspace) ResultsPath() string {
	return filepath.Join(w.Dir, "results.json")
}

// HTMLReportPath returns the directory where the Playwright HTML reporter writes its output.
func (w *Workspace) HTMLReportPath() string {
	return filepath.Join(w.Dir, "html")
}

// AttachmentsPath returns the directory where screenshots and traces are stored.
func (w *Workspace) AttachmentsPath() string {
	return filepath.Join(w.Dir, "test-results")
}

// LinkNodeModules creates a symlink at <workspace>/node_modules pointing at
// the given absolute path so the generated playwright.config.ts can resolve
// `@playwright/test` when Node walks up from the workspace.
func (w *Workspace) LinkNodeModules(target string) error {
	if target == "" {
		return fmt.Errorf("empty node_modules target")
	}
	link := filepath.Join(w.Dir, "node_modules")
	if err := os.Symlink(target, link); err != nil {
		return fmt.Errorf("symlink node_modules: %w", err)
	}
	return nil
}

// FindPlaywrightProjectDir walks up from `start` looking for a directory
// containing `node_modules/@playwright/test`. Returns that directory (the one
// with the node_modules folder), or "" if none found.
func FindPlaywrightProjectDir(start string) string {
	if start == "" {
		return ""
	}
	dir, err := filepath.Abs(start)
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "node_modules", "@playwright", "test")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// Cleanup removes the entire workspace directory tree.
// Should always be deferred immediately after workspace creation.
func (w *Workspace) Cleanup(_ context.Context) error {
	if err := os.RemoveAll(w.Dir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("cleanup workspace %s: %w", w.Dir, err)
	}
	return nil
}

// Exists returns true if the workspace directory is still present on disk.
func (w *Workspace) Exists() bool {
	_, err := os.Stat(w.Dir)
	return err == nil
}
