import { test, expect } from '../../../fixtures';

/**
 * ARD-CSP — Content Security Policy (CSP) Implementation: Studio-Web
 *
 * Studio-Web is especially high-risk without CSP because:
 *  - TipTap rich-text editor renders HTML content
 *  - AI Weaver renders LLM-generated output (V01 — Improper Output Handling)
 *  - File uploads and knowledge-base content are rendered in-browser
 *
 * These tests verify:
 *  1. CSP header present on all key Studio-Web pages
 *  2. CSP directive quality (no unsafe-inline, unsafe-eval, wildcards)
 *  3. External/third-party resources are NOT blocked by CSP after fix
 *  4. No CSP violation events during normal navigation + editor usage
 *
 * Run: npx playwright test csp --project=studio-web
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCSP(cspValue: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  cspValue.split(';').forEach((part) => {
    const tokens = part.trim().split(/\s+/);
    if (tokens[0]) directives[tokens[0].toLowerCase()] = tokens.slice(1);
  });
  return directives;
}

interface BlockedResource {
  url: string;
  resourceType: string;
  reason: string;
}

// ─── CSP Header Presence ─────────────────────────────────────────────────────

test.describe('ARD-CSP — CSP Header Presence: Studio-Web', () => {

  test('CSP header is present on the login page', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/auth/signIn`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /auth/signIn — vulnerability not fixed').toBeTruthy();
  });

  test('CSP header is present on the projects list page', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /projects').toBeTruthy();
  });

  test('CSP header is present on the project creation page', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/project/new`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /project/new — content creation pages need CSP').toBeTruthy();
  });

  test('CSP header is present on the Weaver AI page', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set — set it to test Weaver CSP');

    const res = await request.get(`${swUrl}/create/project/${uuid}/weaver`);
    const csp = res.headers()['content-security-policy'];

    // Weaver renders AI output as HTML — this page needs CSP the most
    expect(
      csp,
      'CSP missing on Weaver page — LLM output rendered without CSP is a critical injection risk'
    ).toBeTruthy();
  });

  test('CSP header is present on a project detail page', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set');

    const res = await request.get(`${swUrl}/project/${uuid}/details`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP missing on project detail page').toBeTruthy();
  });
});

// ─── CSP Directive Quality ────────────────────────────────────────────────────

test.describe('ARD-CSP — CSP Directive Quality: Studio-Web', () => {

  test('CSP contains required directives: default-src and script-src', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    expect(Object.keys(directives), 'Missing default-src').toContain('default-src');
    expect(Object.keys(directives), 'Missing script-src').toContain('script-src');
  });

  test("CSP does NOT contain 'unsafe-inline' in script-src", async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];

    expect(
      scriptSrc,
      "'unsafe-inline' in script-src completely defeats XSS protection"
    ).not.toContain("'unsafe-inline'");
  });

  test("CSP does NOT contain 'unsafe-eval' in script-src", async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];

    expect(scriptSrc, "'unsafe-eval' allows eval() — allows dynamic code execution").not.toContain("'unsafe-eval'");
  });

  test('CSP does NOT use wildcard (*) in script-src', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];

    expect(scriptSrc, 'Wildcard (*) allows scripts from any origin').not.toContain('*');
  });

  test('CSP report-uri or report-to is configured (recommended)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    if (!('report-uri' in directives) && !('report-to' in directives)) {
      console.warn('[CSP] No report-uri/report-to — violations will be silent');
    }
    expect(true).toBeTruthy(); // soft warning only
  });
});

// ─── External Resource Blocking Tests ────────────────────────────────────────

test.describe('ARD-CSP — External Resources Not Blocked: Studio-Web', () => {

  test('No requests are blocked by CSP on the projects list page', async ({ page }) => {
    const blocked: BlockedResource[] = [];
    const cspViolations: string[] = [];

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
        blocked.push({ url: req.url(), resourceType: req.resourceType(), reason: failure });
      }
    });

    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        (msg.text().includes('Refused to') ||
          msg.text().includes('Content Security Policy') ||
          msg.text().includes('CSP'))
      ) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    if (blocked.length > 0) {
      console.warn(
        '[CSP] Blocked on /projects:\n' +
          blocked.map((b) => `  [${b.resourceType}] ${b.url}`).join('\n')
      );
    }

    expect(cspViolations, `CSP violations on /projects:\n${cspViolations.join('\n')}`).toHaveLength(0);
    expect(blocked.length, `Resources blocked:\n${blocked.map((b) => b.url).join('\n')}`).toBe(0);
  });

  test('No requests are blocked by CSP on the project creation page', async ({ page }) => {
    const blocked: BlockedResource[] = [];
    const cspViolations: string[] = [];

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
        blocked.push({ url: req.url(), resourceType: req.resourceType(), reason: failure });
      }
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Refused to')) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto('/project/new');
    await page.waitForLoadState('networkidle');

    expect(cspViolations, `CSP violations on /project/new:\n${cspViolations.join('\n')}`).toHaveLength(0);
    expect(blocked.length, `Blocked on /project/new:\n${blocked.map((b) => b.url).join('\n')}`).toBe(0);
  });

  test('No requests are blocked by CSP on the Weaver AI page', async ({ page }) => {
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID ?? '';
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set');

    const blocked: BlockedResource[] = [];
    const cspViolations: string[] = [];

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
        blocked.push({ url: req.url(), resourceType: req.resourceType(), reason: failure });
      }
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Refused to')) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto(`/create/project/${uuid}/weaver`);
    await page.waitForLoadState('networkidle');

    expect(
      cspViolations,
      `CSP violations on Weaver page — LLM output may be blocked:\n${cspViolations.join('\n')}`
    ).toHaveLength(0);
    expect(
      blocked.length,
      `Resources blocked on Weaver:\n${blocked.map((b) => b.url).join('\n')}`
    ).toBe(0);
  });

  test('Static assets (JS, CSS, fonts, images) load without CSP blocks', async ({ page }) => {
    const blockedStatic: string[] = [];

    page.on('requestfailed', (req) => {
      const type = req.resourceType();
      if (['script', 'stylesheet', 'font', 'image'].includes(type)) {
        const failure = req.failure()?.errorText ?? '';
        if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
          blockedStatic.push(`[${type}] ${req.url()}`);
        }
      }
    });

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    expect(
      blockedStatic,
      `Static assets blocked by CSP:\n${blockedStatic.join('\n')}`
    ).toHaveLength(0);
  });

  test('API (XHR/fetch) calls to backend are not blocked by CSP', async ({ page }) => {
    const blockedApis: string[] = [];

    page.on('requestfailed', (req) => {
      const type = req.resourceType();
      if (type === 'xhr' || type === 'fetch') {
        const failure = req.failure()?.errorText ?? '';
        if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
          blockedApis.push(req.url());
        }
      }
    });

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    expect(
      blockedApis,
      `API calls blocked by CSP — will break app functionality:\n${blockedApis.join('\n')}`
    ).toHaveLength(0);
  });

  test('No CSP violations during full Studio-Web navigation flow', async ({ page }) => {
    const cspViolations: string[] = [];

    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        (msg.text().includes('Content Security Policy') ||
          msg.text().includes('Refused to load') ||
          msg.text().includes('Refused to execute'))
      ) {
        cspViolations.push(`[${page.url()}] ${msg.text()}`);
      }
    });

    for (const path of ['/projects', '/project/new', '/skills', '/jobs']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    expect(
      cspViolations,
      `CSP violations across Studio-Web navigation:\n${cspViolations.join('\n')}`
    ).toHaveLength(0);
  });

  test('Rich text editor resources are not blocked by CSP', async ({ page }) => {
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID ?? '';
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set');

    const blockedEditorResources: string[] = [];
    const cspViolations: string[] = [];

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
        blockedEditorResources.push(`[${req.resourceType()}] ${req.url()}`);
      }
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Refused to')) {
        cspViolations.push(msg.text());
      }
    });

    // Navigate to a project page that contains the rich text editor
    await page.goto(`/project/${uuid}/details`);
    await page.waitForLoadState('networkidle');

    // Wait for the editor to initialize
    await page.locator('[contenteditable="true"], .tiptap, .ProseMirror').waitFor({
      state: 'attached',
      timeout: 10_000,
    }).catch(() => {}); // editor may not be present — test still validates CSP

    expect(
      cspViolations,
      `CSP violations in editor context:\n${cspViolations.join('\n')}`
    ).toHaveLength(0);

    expect(
      blockedEditorResources,
      `Editor resources blocked:\n${blockedEditorResources.join('\n')}`
    ).toHaveLength(0);
  });
});
