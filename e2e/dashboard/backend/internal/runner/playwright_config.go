package runner

import (
	"fmt"
	"strings"
)

// PlaywrightConfigOptions holds all the values needed to generate a playwright.config.ts.
// Nothing is hardcoded — every value comes from the DB or the run request.
type PlaywrightConfigOptions struct {
	// WorkspaceDir is the absolute path to the temp run directory.
	WorkspaceDir string

	// TestFiles is a list of absolute paths to the test files to execute.
	// If empty, Playwright will discover all .js files in WorkspaceDir.
	TestFiles []string

	// Workers controls parallelism within a single run (default 1 for isolation).
	Workers int

	// Retries is the number of times to retry a failed test.
	Retries int

	// Timeout is the per-test timeout in milliseconds.
	Timeout int

	// Screenshot controls when screenshots are taken: "on", "off", "only-on-failure"
	Screenshot string

	// Trace controls when traces are captured: "on", "off", "retain-on-failure"
	Trace string
}

// DefaultConfigOptions returns sensible defaults matching the architecture spec.
func DefaultConfigOptions(workspaceDir string) PlaywrightConfigOptions {
	return PlaywrightConfigOptions{
		WorkspaceDir: workspaceDir,
		Workers:      1,
		Retries:      0,
		Timeout:      30000, // 30 seconds
		Screenshot:   "only-on-failure",
		Trace:        "retain-on-failure",
	}
}

// GenerateConfig produces the content of playwright.config.ts as a string.
// The generated config uses process.env for baseURL and credentials — nothing is
// written to disk that contains credentials.
//
// Generated at runtime — never stored, never hardcoded.
func GenerateConfig(opts PlaywrightConfigOptions) string {
	workers := opts.Workers
	if workers < 1 {
		workers = 1
	}

	retries := opts.Retries
	if retries < 0 {
		retries = 0
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 30000
	}

	screenshot := opts.Screenshot
	if screenshot == "" {
		screenshot = "only-on-failure"
	}

	trace := opts.Trace
	if trace == "" {
		trace = "retain-on-failure"
	}

	// Build testMatch glob or use testDir
	var testDirSection string
	if len(opts.TestFiles) > 0 {
		// List specific files using testMatch
		var quoted []string
		for _, f := range opts.TestFiles {
			quoted = append(quoted, fmt.Sprintf("'%s'", escapeForJS(f)))
		}
		testDirSection = fmt.Sprintf("  testMatch: [%s],", strings.Join(quoted, ", "))
	} else {
		testDirSection = fmt.Sprintf("  testDir: '%s',", escapeForJS(opts.WorkspaceDir))
	}

	return fmt.Sprintf(`import { defineConfig } from '@playwright/test';

// Scout-generated config — do not edit manually.
// Generated at run time. All secrets injected via process.env only.
export default defineConfig({
%s
  fullyParallel: false,
  workers: %d,
  retries: %d,
  timeout: %d,
  reporter: [
    ['json', { outputFile: '%s' }],
    ['html', { outputFolder: '%s', open: 'never' }],
    ['line'],
  ],
  use: {
    // Injected by Scout runner as OS-level env vars — never written to disk.
    baseURL: process.env.TESTDECK_BASE_URL,
    screenshot: '%s',
    trace: '%s',
    video: 'off',
    // Credentials injected as process.env.TESTDECK_EMAIL / TESTDECK_PASSWORD
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
`,
		testDirSection,
		workers,
		retries,
		timeout,
		escapeForJS(opts.WorkspaceDir+"/results.json"),
		escapeForJS(opts.WorkspaceDir+"/html"),
		screenshot,
		trace,
	)
}

// escapeForJS escapes single quotes and backslashes in a string for safe
// embedding inside a JS single-quoted string literal.
func escapeForJS(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `'`, `\'`)
	return s
}
