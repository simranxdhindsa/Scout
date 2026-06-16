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

	// Video controls when video is recorded: "on", "off", "retain-on-failure"
	Video string

	// Headed, when true, runs Playwright with a visible browser window instead of headless.
	Headed bool

	// AuthSetupFile, when non-empty, is the absolute path to a generated login
	// setup spec. A 'setup' project runs it before the main project, which then
	// reuses the saved session via AuthStatePath. Both must be set to enable auth.
	AuthSetupFile string

	// AuthStatePath is where the setup saves storageState and where the main
	// project loads it from.
	AuthStatePath string
}

// DefaultConfigOptions returns sensible defaults matching the architecture spec.
func DefaultConfigOptions(workspaceDir string) PlaywrightConfigOptions {
	return PlaywrightConfigOptions{
		WorkspaceDir: workspaceDir,
		Workers:      1,
		Retries:      0,
		Timeout:      30000, // 30 seconds
		Screenshot:   "on",               // "on" so screenshots stream live via WebSocket watcher
		Trace:        "retain-on-failure", // traces saved for failed tests
		Video:        "retain-on-failure", // videos saved for failed tests
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

	video := opts.Video
	if video == "" {
		video = "retain-on-failure"
	}

	// When credentials are available the runner generates a login setup spec.
	// A dedicated 'setup' project runs it first; the main project then declares
	// a dependency on it and loads the saved session via storageState, so every
	// spec runs authenticated (mirrors the ardoise-tests global-setup.ts flow).
	authEnabled := opts.AuthSetupFile != "" && opts.AuthStatePath != ""
	var setupProject, deps, storageStateLine string
	if authEnabled {
		setupProject = fmt.Sprintf(`    {
      name: 'setup',
      testMatch: ['%s'],
    },
`, escapeForJS(opts.AuthSetupFile))
		deps = "      dependencies: ['setup'],\n"
		storageStateLine = fmt.Sprintf("        storageState: '%s',\n", escapeForJS(opts.AuthStatePath))
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
    ['list', { printSteps: false }],
  ],
  use: {
    // Injected by Scout runner as OS-level env vars — never written to disk.
    baseURL: process.env.TESTDECK_BASE_URL,
    screenshot: '%s',
    trace: '%s',
    video: '%s',
    // Credentials injected as process.env.TESTDECK_EMAIL / TESTDECK_PASSWORD
  },
  projects: [
%s    {
      name: 'chromium',
%s      use: {
        browserName: 'chromium',
        headless: %s,
        viewport: { width: 1280, height: 720 },
%s      },
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
		video,
		setupProject,
		deps,
		func() string {
			if opts.Headed {
				return "false"
			}
			return "true"
		}(),
		storageStateLine,
	)
}

// GenerateAuthSetup produces a Playwright "setup" spec that logs in using the
// credentials the runner injects as env vars (TESTDECK_BASE_URL / TESTDECK_EMAIL
// / TESTDECK_PASSWORD) and saves the authenticated session to authStatePath.
// This mirrors the ardoise-tests global-setup.ts so dashboard runs are
// authenticated like a local run. String concatenation (not template literals)
// keeps the JS free of backticks so it embeds cleanly in a Go raw string.
func GenerateAuthSetup(authStatePath string) string {
	return fmt.Sprintf(`import { test as setup } from '@playwright/test';

// Scout-generated auth setup — do not edit manually.
// Logs in once and saves the session so every test runs authenticated.
const authFile = '%s';

setup('authenticate', async ({ page }) => {
  const baseURL = process.env.TESTDECK_BASE_URL;
  const email = process.env.TESTDECK_EMAIL || '';
  const password = process.env.TESTDECK_PASSWORD || '';

  await page.goto(baseURL + '/auth/signIn', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Some deployments show a pre-step button before the email/password fields.
  const preStep = page.locator('//*[@id="__next"]/div/div/div[1]/form/div/div/button');
  try {
    await preStep.waitFor({ timeout: 3000 });
    await preStep.click();
  } catch (e) {
    // Pre-step button not present on this deployment — proceed.
  }

  if (!email || !password) {
    throw new Error('Scout auth setup: no credentials provided. Set username/password on the run environment.');
  }

  const emailInput = page.locator('[data-test="email-input"]');
  await emailInput.waitFor({ timeout: 30000 });
  await emailInput.fill(email);
  await page.locator('[data-test="password-input"]').fill(password);
  await page.locator('button[type="submit"][data-button="true"]').click();

  // Wait until redirected away from sign-in (dashboard or onboarding).
  try {
    await page.waitForURL((url) => !url.pathname.includes('/auth/signIn'), { timeout: 20000 });
  } catch (e) {
    // Login did not complete — surface WHY instead of a bare navigation timeout.
    const currentURL = page.url();
    let errText = '';
    for (const sel of ['[role="alert"]', '[data-test*="error"]', '.error', '[aria-live="assertive"]']) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count()) { errText = (await loc.innerText()).trim(); if (errText) break; }
      } catch (_) { /* ignore */ }
    }
    throw new Error(
      'Scout auth setup: login did not complete (still on sign-in).' +
      ' baseURL=' + baseURL + ' email=' + email +
      ' finalURL=' + currentURL +
      (errText ? ' pageError="' + errText + '"' : ' (no visible error message found)')
    );
  }

  // Save authenticated session (cookies + localStorage) for test reuse.
  await page.context().storageState({ path: authFile });
});
`, escapeForJS(authStatePath))
}

// escapeForJS escapes single quotes and backslashes in a string for safe
// embedding inside a JS single-quoted string literal.
func escapeForJS(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `'`, `\'`)
	return s
}
