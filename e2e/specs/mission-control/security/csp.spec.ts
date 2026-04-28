import { test, expect } from '../../../fixtures';

/**
 * ARD-CSP — Content Security Policy (CSP) Implementation: Mission-Control
 *
 * Vulnerability: No CSP configured — leaves the admin app unprotected against XSS.
 * These tests verify:
 *  1. CSP header is present on all key pages
 *  2. CSP does NOT contain dangerous directives
 *  3. External/third-party resources load correctly and are NOT blocked by CSP
 *  4. No CSP violation events fire during normal navigation
 *
 * Run: npx playwright test csp --project=mission-control
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

// ─── CSP Header Tests ────────────────────────────────────────────────────────

test.describe('ARD-CSP — CSP Header Presence: Mission-Control', () => {

  test('CSP header is present on the login page', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/auth/signIn`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /auth/signIn — vulnerability not fixed').toBeTruthy();
  });

  test('CSP header is present on the courses list page', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /courses').toBeTruthy();
  });

  test('CSP header is present on the configurations page', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/configurations`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /configurations').toBeTruthy();
  });

  test('CSP header is present on the bundles page', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/bundles`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing on /bundles').toBeTruthy();
  });
});

// ─── CSP Directive Quality Tests ─────────────────────────────────────────────

test.describe('ARD-CSP — CSP Directive Quality: Mission-Control', () => {

  test('CSP contains required directives: default-src and script-src', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    expect(Object.keys(directives), 'Missing default-src directive').toContain('default-src');
    expect(Object.keys(directives), 'Missing script-src directive').toContain('script-src');
  });

  test("CSP does NOT contain 'unsafe-inline' in script-src", async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];

    expect(scriptSrc, "'unsafe-inline' in script-src defeats XSS protection").not.toContain("'unsafe-inline'");
  });

  test("CSP does NOT contain 'unsafe-eval' in script-src", async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];

    expect(scriptSrc, "'unsafe-eval' allows eval() — major XSS risk").not.toContain("'unsafe-eval'");
  });

  test('CSP does NOT use wildcard (*) in script-src', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];

    expect(scriptSrc, 'Wildcard (*) allows any origin to execute scripts').not.toContain('*');
  });

  test('CSP report-uri or report-to directive is configured (recommended)', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present — fix not yet deployed');

    const directives = parseCSP(csp);
    const hasReporting = 'report-uri' in directives || 'report-to' in directives;

    if (!hasReporting) {
      console.warn('[CSP] No report-uri/report-to — CSP violations will be silent in production');
    }
    expect(true).toBeTruthy(); // soft warning only
  });
});

// ─── External Resource Blocking Tests ────────────────────────────────────────

test.describe('ARD-CSP — External Resources Not Blocked: Mission-Control', () => {

  test('No requests are blocked by CSP on /courses page', async ({ page }) => {
    const blocked: BlockedResource[] = [];
    const cspViolations: string[] = [];

    // Capture any requests that fail (CSP blocks appear as failed requests)
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (
        failure.includes('net::ERR_BLOCKED_BY_CLIENT') ||
        failure.includes('net::ERR_BLOCKED_BY_RESPONSE') ||
        failure.includes('Content Security Policy')
      ) {
        blocked.push({
          url: req.url(),
          resourceType: req.resourceType(),
          reason: failure,
        });
      }
    });

    // Capture CSP violation console errors
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        (msg.text().includes('Content Security Policy') ||
          msg.text().includes('CSP') ||
          msg.text().includes('Refused to'))
      ) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    // Report all blocked resources
    if (blocked.length > 0) {
      console.warn(
        '[CSP] Blocked resources on /courses:\n' +
          blocked.map((b) => `  [${b.resourceType}] ${b.url} — ${b.reason}`).join('\n')
      );
    }

    expect(
      cspViolations,
      `CSP violations on /courses:\n${cspViolations.join('\n')}`
    ).toHaveLength(0);

    expect(
      blocked.length,
      `${blocked.length} resource(s) blocked on /courses:\n` +
        blocked.map((b) => `  ${b.url}`).join('\n')
    ).toBe(0);
  });

  test('No requests are blocked by CSP on /bundles page', async ({ page }) => {
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

    await page.goto('/bundles');
    await page.waitForLoadState('networkidle');

    expect(cspViolations, `CSP violations on /bundles:\n${cspViolations.join('\n')}`).toHaveLength(0);
    expect(blocked.length, `Blocked on /bundles:\n${blocked.map((b) => b.url).join('\n')}`).toBe(0);
  });

  test('No requests are blocked on course creation page', async ({ page }) => {
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

    await page.goto('/course/new');
    await page.waitForLoadState('networkidle');

    expect(cspViolations, `CSP violations on /course/new:\n${cspViolations.join('\n')}`).toHaveLength(0);
    expect(blocked.length, `Blocked on /course/new:\n${blocked.map((b) => b.url).join('\n')}`).toBe(0);
  });

  test('Static assets (JS, CSS, fonts, images) all load without CSP blocks', async ({ page }) => {
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

    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    expect(
      blockedStatic,
      `Static assets blocked by CSP:\n${blockedStatic.join('\n')}`
    ).toHaveLength(0);
  });

  test('API (XHR/fetch) calls to the core backend are not blocked by CSP', async ({ page }) => {
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

    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    expect(
      blockedApis,
      `API calls blocked by CSP — these will break app functionality:\n${blockedApis.join('\n')}`
    ).toHaveLength(0);
  });

  test('No CSP violations during full MC navigation flow', async ({ page }) => {
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

    // Navigate through the main MC sections
    for (const path of ['/courses', '/bundles', '/organisations', '/configurations']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    expect(
      cspViolations,
      `CSP violations across MC navigation:\n${cspViolations.join('\n')}`
    ).toHaveLength(0);
  });
});
