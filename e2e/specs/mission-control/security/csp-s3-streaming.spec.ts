import { test, expect } from '../../../fixtures';

/**
 * ARD-CSP — S3 / CloudFront / Streaming Resource Tests: Mission-Control
 *
 * Based on mission-control/src/middleware.ts buildCsp():
 *
 *   media-src  'self' data: blob: {appOrigins} {assetOrigins+s3Origins}
 *   img-src    'self' data: blob: {appOrigins} {assetOrigins+s3Origins}
 *   connect-src 'self' {appOrigins} {assetOrigins+s3Origins}
 *   font-src   'self' data: https://fonts.gstatic.com
 *   style-src  'self' 'unsafe-inline' https://fonts.googleapis.com
 *   script-src 'self' 'unsafe-inline' (+ 'unsafe-eval' in dev)
 *
 *   assetOrigins (stage/dev) = https://d34vl2bsyy5afv.cloudfront.net
 *   assetOrigins (prod)      = https://core-assets.ardoise.ai
 *   s3Origins = https://{S3_BUCKET_NAME}.s3.{S3_REGION}.amazonaws.com
 *               https://{S3_BUCKET_FOR_THEME_IMAGES}.s3.{S3_REGION}.amazonaws.com
 *
 * These tests verify the CSP as set by middleware allows all streaming origins.
 *
 * Run: npx playwright test csp-s3-streaming --project=mission-control
 */

function parseCSP(cspValue: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  cspValue.split(';').forEach((part) => {
    const tokens = part.trim().split(/\s+/);
    if (tokens[0]) directives[tokens[0].toLowerCase()] = tokens.slice(1);
  });
  return directives;
}

// ─── CSP Directive Checks (based on actual middleware output) ────────────────

test.describe('ARD-CSP — Streaming Directives in CSP: Mission-Control', () => {

  test("media-src allows blob: (required for MediaSource/audio streaming)", async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const mediaSrc = (directives['media-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(
      mediaSrc.includes('blob:'),
      `media-src must allow blob: — audio streaming uses URL.createObjectURL()\nActual: ${mediaSrc}`
    ).toBe(true);
  });

  test("media-src allows data: (for inline audio/video fallbacks)", async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const mediaSrc = (directives['media-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(
      mediaSrc.includes('data:'),
      `media-src must allow data:\nActual: ${mediaSrc}`
    ).toBe(true);
  });

  test('media-src includes CloudFront asset origin', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const mediaSrc = (directives['media-src'] ?? directives['default-src'] ?? []).join(' ');

    // middleware sets CloudFront or core-assets depending on APP_ENV
    const hasCloudFront =
      mediaSrc.includes('cloudfront.net') || mediaSrc.includes('core-assets.ardoise.ai');

    expect(
      hasCloudFront,
      `media-src must include CloudFront/core-assets origin for streamed video/audio\nActual: ${mediaSrc}`
    ).toBe(true);
  });

  test('connect-src includes app and asset origins (for fetch-based streaming)', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const connectSrc = (directives['connect-src'] ?? directives['default-src'] ?? []).join(' ');

    // Must include at least one app origin (ardoirse.com / ardoisestage.com / ardoise.ai)
    const hasAppOrigin =
      connectSrc.includes('ardoirse.com') ||
      connectSrc.includes('ardoisestage.com') ||
      connectSrc.includes('ardoise.ai');

    expect(
      hasAppOrigin,
      `connect-src must include app origins for API streaming calls\nActual: ${connectSrc}`
    ).toBe(true);
  });

  test('img-src includes CloudFront origin (for thumbnails and branding images)', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const imgSrc = (directives['img-src'] ?? directives['default-src'] ?? []).join(' ');

    const hasCloudFront =
      imgSrc.includes('cloudfront.net') || imgSrc.includes('core-assets.ardoise.ai');

    expect(
      hasCloudFront,
      `img-src must include CloudFront/core-assets for thumbnails\nActual: ${imgSrc}`
    ).toBe(true);
  });

  test("img-src allows blob: and data: (for avatar uploads and inline images)", async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const imgSrc = (directives['img-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(imgSrc.includes('blob:'), `img-src must allow blob:\nActual: ${imgSrc}`).toBe(true);
    expect(imgSrc.includes('data:'), `img-src must allow data:\nActual: ${imgSrc}`).toBe(true);
  });

  test('font-src includes fonts.gstatic.com (for Google Fonts)', async ({ request }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    const res = await request.get(`${mcUrl}/courses`);
    const csp = res.headers()['content-security-policy'];
    test.skip(!csp, 'CSP header not present');

    const directives = parseCSP(csp);
    const fontSrc = (directives['font-src'] ?? directives['default-src'] ?? []).join(' ');

    expect(
      fontSrc.includes('fonts.gstatic.com'),
      `font-src must include fonts.gstatic.com\nActual: ${fontSrc}`
    ).toBe(true);
  });
});

// ─── Runtime: Verify nothing is actually blocked ─────────────────────────────

test.describe('ARD-CSP — No Resources Blocked at Runtime: Mission-Control', () => {

  test('No media/image/fetch requests blocked during /courses page load', async ({ page }) => {
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

    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    if (blocked.length > 0) {
      console.warn(
        '[CSP Block] Resources blocked on /courses:\n' +
          blocked.map((b) => `  [${b.type}] ${b.url}\n    reason: ${b.reason}`).join('\n')
      );
    }

    expect(cspErrors, `CSP console errors:\n${cspErrors.join('\n')}`).toHaveLength(0);
    expect(blocked, `Blocked resources:\n${blocked.map((b) => b.url).join('\n')}`).toHaveLength(0);
  });

  test('Course detail page loads all resources without CSP blocks', async ({ page }) => {
    const uuid = process.env.PLAYWRIGHT_MC_COURSE_UUID ?? '';
    test.skip(!uuid, 'PLAYWRIGHT_MC_COURSE_UUID not set — set to test course detail CSP');

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

    await page.goto(`/course/${uuid}/overview`);
    await page.waitForLoadState('networkidle');

    expect(cspErrors, `CSP errors on course overview:\n${cspErrors.join('\n')}`).toHaveLength(0);
    expect(blocked, `Blocked on course overview:\n${blocked.join('\n')}`).toHaveLength(0);
  });

  test('Audit: log all external resource origins loaded on /courses', async ({ page }) => {
    const externalOrigins = new Set<string>();

    page.on('response', (res) => {
      try {
        const origin = new URL(res.url()).origin;
        if (!origin.includes('localhost') && !origin.startsWith('data:')) {
          externalOrigins.add(`[${res.request().resourceType()}] ${res.status()} ${origin}`);
        }
      } catch {}
    });

    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    console.log(
      '[Origin Audit] External origins on /courses:\n' +
        [...externalOrigins].sort().map((o) => `  ${o}`).join('\n')
    );

    // This test always passes — it's an audit to confirm which origins CSP must allow
    expect(true).toBeTruthy();
  });
});
