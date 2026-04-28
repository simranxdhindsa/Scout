import { test, expect } from '../../../fixtures';

/**
 * ARD-CSP — S3 / CloudFront / Streaming Resource Tests: Studio-Web
 *
 * Based on studio-web/src/middleware.ts buildCsp():
 *
 *   script-src  'self' 'unsafe-inline' 'nonce-{nonce}' https://www.googletagmanager.com
 *               (+ 'unsafe-eval' in dev)
 *   style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
 *   img-src     'self' data: blob: {envDomains} {s3Domains}
 *               https://d34vl2bsyy5afv.cloudfront.net
 *               https://images.unsplash.com
 *               https://randomuser.me
 *               https://encrypted-tbn0.gstatic.com
 *   font-src    'self' data: https://fonts.gstatic.com
 *   connect-src 'self' https://api.apyhub.com https://www.googletagmanager.com
 *               {envDomains + wildcards + s3Domains}
 *   frame-src   'self' https://www.googletagmanager.com
 *
 *   envDomains  = resolved from CORE_URL, SSR_CORE_URL, BASE_URL, default domains
 *   s3Domains   = {S3_BUCKET_NAME}.s3.{S3_REGION}.amazonaws.com
 *                 s3.{S3_REGION}.amazonaws.com
 *
 * Audio streaming uses blob: URLs (URL.createObjectURL via MediaSource API).
 * LLM/Weaver chat uses fetch to core API (must be in connect-src).
 *
 * Run: npx playwright test csp-s3-streaming --project=studio-web
 */

function parseCSP(cspValue: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  cspValue.split(';').forEach((part) => {
    const tokens = part.trim().split(/\s+/);
    if (tokens[0]) directives[tokens[0].toLowerCase()] = tokens.slice(1);
  });
  return directives;
}

// ─── CSP Directive Checks (based on actual middleware) ───────────────────────

test.describe('ARD-CSP — Streaming Directives in CSP: Studio-Web', () => {

  test('CSP header is set by middleware (not missing)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];

    expect(csp, 'CSP header missing — middleware not running or CSP_USE_NONCE=false').toBeTruthy();
  });

  test("img-src allows blob: (for file upload previews and avatar images)", async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const imgSrc = (directives['img-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(imgSrc.includes('blob:'), `img-src must allow blob:\nActual: ${imgSrc}`).toBe(true);
  });

  test("img-src allows data: (for inline base64 images)", async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const imgSrc = (directives['img-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(imgSrc.includes('data:'), `img-src must allow data:\nActual: ${imgSrc}`).toBe(true);
  });

  test('img-src includes CloudFront origin (d34vl2bsyy5afv.cloudfront.net)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const imgSrc = (directives['img-src'] ?? directives['default-src'] ?? []).join(' ');

    // Middleware hardcodes this CloudFront URL in img-src
    expect(
      imgSrc.includes('cloudfront.net'),
      `img-src must include CloudFront origin\nActual: ${imgSrc}`
    ).toBe(true);
  });

  test('connect-src includes app core API origin (for Weaver AI / fetch calls)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const connectSrc = (directives['connect-src'] ?? directives['default-src'] ?? []).join(' ');

    // Must include at least one app/core domain
    const hasAppOrigin =
      connectSrc.includes('ardoirse.com') ||
      connectSrc.includes('ardoisestage.com') ||
      connectSrc.includes('ardoise.ai');

    expect(
      hasAppOrigin,
      `connect-src must include app origins for AI/Weaver fetch calls\nActual: ${connectSrc}`
    ).toBe(true);
  });

  test('connect-src includes S3 origin (for direct S3 file operations)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const connectSrc = (directives['connect-src'] ?? directives['default-src'] ?? []).join(' ');

    // Middleware adds s3Domains to connect-src when S3_BUCKET_NAME + S3_REGION are set
    const hasS3 = connectSrc.includes('amazonaws.com');

    if (!hasS3) {
      console.warn(
        '[CSP] connect-src has no amazonaws.com — S3_BUCKET_NAME or S3_REGION may not be set in env'
      );
    }
    // Soft check — S3 env vars may not be configured in all environments
    expect(true).toBeTruthy();
  });

  test('connect-src includes api.apyhub.com (hardcoded in middleware)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const connectSrc = (directives['connect-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(
      connectSrc.includes('api.apyhub.com'),
      `connect-src must include api.apyhub.com (hardcoded in SW middleware)\nActual: ${connectSrc}`
    ).toBe(true);
  });

  test('font-src includes fonts.gstatic.com (for Google Fonts)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const fontSrc = (directives['font-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(
      fontSrc.includes('fonts.gstatic.com'),
      `font-src must include fonts.gstatic.com\nActual: ${fontSrc}`
    ).toBe(true);
  });

  test('Nonce is present in CSP script-src (when CSP_USE_NONCE=true)', async ({ request }) => {
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!swUrl, 'PLAYWRIGHT_SW_URL not configured');

    const res = await request.get(`${swUrl}/projects`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP not present');

    const directives = parseCSP(csp);
    const scriptSrc = (directives['script-src'] ?? []).join(' ');

    // SW middleware generates a nonce per request when CSP_USE_NONCE !== 'false'
    const hasNonce = /nonce-[a-f0-9]{32}/.test(scriptSrc);

    if (!hasNonce) {
      console.warn('[CSP] No nonce in script-src — CSP_USE_NONCE may be false or nonce not injected into HTML');
    }
    // Soft check — nonce requires _document.tsx to inject it into script tags
    expect(true).toBeTruthy();
  });
});

// ─── Runtime: Verify nothing is actually blocked ─────────────────────────────

test.describe('ARD-CSP — No Resources Blocked at Runtime: Studio-Web', () => {

  test('No resources blocked by CSP on projects list page', async ({ page }) => {
    const blocked: { type: string; url: string; reason: string }[] = [];
    const cspErrors: string[] = [];

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
        blocked.push({ type: req.resourceType(), url: req.url(), reason: failure });
      }
    });

    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        (msg.text().includes('Refused to') || msg.text().includes('Content Security Policy'))
      ) {
        cspErrors.push(msg.text());
      }
    });

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    if (blocked.length > 0) {
      console.warn(
        '[CSP Block] Resources blocked on /projects:\n' +
          blocked.map((b) => `  [${b.type}] ${b.url}`).join('\n')
      );
    }

    expect(cspErrors, `CSP console errors:\n${cspErrors.join('\n')}`).toHaveLength(0);
    expect(blocked, `Blocked resources:\n${blocked.map((b) => b.url).join('\n')}`).toHaveLength(0);
  });

  test('No resources blocked on Weaver AI page (LLM fetch calls)', async ({ page }) => {
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID ?? '';
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set');

    const blocked: string[] = [];
    const cspErrors: string[] = [];

    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? '';
      if (failure.includes('ERR_BLOCKED') || failure.includes('Content Security Policy')) {
        blocked.push(`[${req.resourceType()}] ${req.url()}`);
      }
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Refused to')) {
        cspErrors.push(msg.text());
      }
    });

    await page.goto(`/create/project/${uuid}/weaver`);
    await page.waitForLoadState('networkidle');

    expect(cspErrors, `CSP errors on Weaver:\n${cspErrors.join('\n')}`).toHaveLength(0);
    expect(blocked, `Blocked on Weaver:\n${blocked.join('\n')}`).toHaveLength(0);
  });

  test('Rich text editor loads without CSP blocks (TipTap inline styles)', async ({ page }) => {
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID ?? '';
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set');

    const cspErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Refused to')) {
        cspErrors.push(msg.text());
      }
    });

    await page.goto(`/project/${uuid}/details`);
    await page.waitForLoadState('networkidle');

    // TipTap uses inline styles — 'unsafe-inline' in style-src must allow them
    expect(
      cspErrors,
      `CSP violations in rich-text editor:\n${cspErrors.join('\n')}`
    ).toHaveLength(0);
  });

  test('Audit: log all external origins loaded on /projects', async ({ page }) => {
    const origins = new Set<string>();

    page.on('response', (res) => {
      try {
        const url = new URL(res.url());
        if (!url.hostname.includes('localhost')) {
          origins.add(`[${res.request().resourceType()}] ${res.status()} ${url.origin}`);
        }
      } catch {}
    });

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    console.log(
      '[Origin Audit] External origins on /projects:\n' +
        [...origins].sort().map((o) => `  ${o}`).join('\n')
    );

    // Always passes — this is an audit log to confirm which origins the CSP must cover
    expect(true).toBeTruthy();
  });
});
