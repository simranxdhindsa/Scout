/**
 * Asset page — E2E flow spec.
 *
 * Source: ui/src/pages/[mode]/[courseId]/section/[sectionId]/asset/[assetId]/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. The bulk of
 * the value lives in getServerSideProps routing branches (auth, mode guard,
 * studio access, started_at gating). Pure rendering of CourseAssetBarContent /
 * AssetPreview belongs in component tests with mocks.
 *
 * Required env (see ardoise-tests/.env):
 *   BASE_URL                          — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD        — global-setup session (has studio access)
 *
 * Optional (each unlocks one real-flow test):
 *   TEST_COURSE_ID                    — UUID of a STARTED course the global
 *   TEST_SECTION_ID                     user can access; the section/asset
 *   TEST_ASSET_ID                       must belong to that course
 *
 *   TEST_COURSE_ID_NOT_STARTED        — UUID of a NOT-STARTED course the
 *   TEST_SECTION_ID_NOT_STARTED         global user can access (used to pin
 *   TEST_ASSET_ID_NOT_STARTED           the /courses/<id> and /preview/<id>
 *                                       redirect contracts)
 *
 *   TEST_EMAIL_NON_STUDIO             — user.studio=false; required to pin
 *   TEST_PASSWORD_NON_STUDIO            the mode=preview → /403 branch
 *
 * Notes on what is intentionally NOT tested here:
 *   - Asset bar contents and AssetPreview rendering — no stable selectors in
 *     source, and the rendered payload varies wildly by asset type. Cover in
 *     mocked component tests.
 *   - The verify-token refresh path (SSP:67-76) — exercising it requires
 *     mid-flight cookie manipulation; covered by the refreshToken unit suite.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LOGIN_URL = '/auth/signIn';
const LOGIN_URL_RE = /\/auth\/signIn/;
const NOT_FOUND_URL_RE = /\/404(\?|$|\/)/;
const FORBIDDEN_URL_RE = /\/403(\?|$|\/)/;
const AUTH_STATE = 'playwright/.auth/user.json';

// Placeholder UUIDs used only for routes where the SSR guard fires before
// hitting the backend (invalid mode, unauthenticated middleware redirect).
// Format matches the app's expectation; values are not resolved server-side.
const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';

const SEL = {
  emailInput: '[data-test="email-input"]',
  passwordInput: '[data-test="password-input"]',
};

const TXT = {
  signInBtn: 'Sign In',
  signInWithEmailBtn: 'Sign in with Email',
};

const env = {
  courseId: process.env.TEST_COURSE_ID ?? '',
  sectionId: process.env.TEST_SECTION_ID ?? '',
  assetId: process.env.TEST_ASSET_ID ?? '',

  notStartedCourseId: process.env.TEST_COURSE_ID_NOT_STARTED ?? '',
  notStartedSectionId: process.env.TEST_SECTION_ID_NOT_STARTED ?? '',
  notStartedAssetId: process.env.TEST_ASSET_ID_NOT_STARTED ?? '',

  nonStudioEmail: process.env.TEST_EMAIL_NON_STUDIO ?? '',
  nonStudioPassword: process.env.TEST_PASSWORD_NON_STUDIO ?? '',
};

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------
type Mode = 'courses' | 'preview' | 'studio';

const assetUrl = (mode: Mode | string, courseId: string, sectionId: string, assetId: string) =>
  `/${mode}/${courseId}/section/${sectionId}/asset/${assetId}`;

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const emailInput = (p: Page) => p.locator(SEL.emailInput);
const passwordInput = (p: Page) => p.locator(SEL.passwordInput);
const submitButton = (p: Page) =>
  p.getByRole('button', { name: TXT.signInBtn, exact: true });
const signInWithEmailBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.signInWithEmailBtn, exact: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Reveals the credential form whether the page boots in direct mode or
 * SSO-enabled mode. Races the two states with waitFor — isVisible() snapshots
 * the current moment and misses the first paint.
 */
async function revealCredentialForm(page: Page): Promise<void> {
  const gate = signInWithEmailBtn(page);
  const email = emailInput(page);

  await Promise.race([
    gate.waitFor({ state: 'visible', timeout: 15000 }),
    email.waitFor({ state: 'visible', timeout: 15000 }),
  ]);

  if (await gate.isVisible()) {
    await gate.click();
  }
  await expect(email).toBeVisible();
}

/**
 * Submits the login form and waits for auth to resolve. Anchors on the
 * observable outcome (URL leaves /auth/signIn) rather than a specific NextAuth
 * endpoint — provider id / basePath vary by deployment. Also waits for the
 * post-login redirect chain to settle so subsequent page.goto() calls don't
 * race the client-side router (webkit otherwise throws "Navigation
 * interrupted by another navigation").
 */
async function submitAndAwaitAuth(page: Page): Promise<void> {
  await submitButton(page).click();
  await page.waitForURL((url) => !LOGIN_URL_RE.test(url.pathname), { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

async function loginWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto(LOGIN_URL);
  await revealCredentialForm(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await submitAndAwaitAuth(page);
}

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
// The deployed test environment defaults to French. Pin to English via the
// cookie src/i18n.ts reads at boot so any text-based locator we add later
// stays stable.
test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) return;
  await context.addCookies([
    {
      name: 'userSelectedLanguage',
      value: 'en',
      domain: new URL(baseURL).hostname,
      path: '/',
    },
  ]);
});

// ===========================================================================
// 1. Server-side redirects — auth guard
// ===========================================================================
// The page's getServerSideProps checks auth (line 50), but Edge middleware
// (ui/src/middleware.ts) runs first and redirects any non-public path when no
// session cookie is present. Either layer catches unauthenticated visits.
test.describe('Server-side redirects — auth', () => {
  test('unauthenticated visit redirects to /auth/signIn with callback_url preserved', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    const target = assetUrl('courses', PLACEHOLDER_UUID, PLACEHOLDER_UUID, PLACEHOLDER_UUID);
    await page.goto(target);

    // Middleware encodes the original path into callback_url; both the
    // middleware path and the SSP fallback land on /auth/signIn.
    await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 15000 });
    await expect(page).toHaveURL(
      /callback_url=%2Fcourses%2F00000000-0000-0000-0000-000000000000/,
      { timeout: 5000 }
    );

    await context.close();
  });
});

// ===========================================================================
// 2. Server-side redirects — mode guard (SSP:35-46)
// ===========================================================================
// The mode segment must be one of: 'courses' | 'preview' | 'studio'. Anything
// else redirects to /404. This guard fires AFTER the auth check, so the test
// must run authenticated.
test.describe('Server-side redirects — invalid mode', () => {
  test('authenticated GET with an invalid mode segment redirects to /404', async ({ browser }) => {
    test.skip(
      !process.env.TEST_EMAIL || !process.env.TEST_PASSWORD,
      'TEST_EMAIL / TEST_PASSWORD required to populate playwright/.auth/user.json'
    );

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();

    const target = assetUrl('not-a-real-mode', PLACEHOLDER_UUID, PLACEHOLDER_UUID, PLACEHOLDER_UUID);
    await page.goto(target);

    await expect(page).toHaveURL(NOT_FOUND_URL_RE, { timeout: 15000 });

    await context.close();
  });
});

// ===========================================================================
// 3. Server-side redirects — studio gate (SSP:82-89)
// ===========================================================================
// mode='preview' requires user.studio === truthy. Users without studio access
// get redirected to /403. Pinning this branch needs a seeded user explicitly
// lacking studio access — naming TEST_EMAIL_NON_STUDIO.
test.describe('Server-side redirects — studio access', () => {
  test('mode=preview redirects to /403 when the user lacks studio access', async ({ page }) => {
    test.skip(
      !env.nonStudioEmail || !env.nonStudioPassword,
      'TEST_EMAIL_NON_STUDIO / TEST_PASSWORD_NON_STUDIO required (seed a user with studio=false)'
    );

    await loginWith(page, env.nonStudioEmail, env.nonStudioPassword);

    const target = assetUrl('preview', PLACEHOLDER_UUID, PLACEHOLDER_UUID, PLACEHOLDER_UUID);
    await page.goto(target);

    await expect(page).toHaveURL(FORBIDDEN_URL_RE, { timeout: 20000 });
  });
});

// ===========================================================================
// 4. Server-side redirects — not-yet-started course (SSP:101-119)
// ===========================================================================
// If the fetched course has no `started_at`, the user is bounced to the
// course-landing page. Routing target depends on mode:
//   - mode=courses → /courses/<courseId>
//   - mode=preview → /preview/<courseId>
// Both branches need a real not-started course UUID the global user can read.
test.describe('Server-side redirects — course not started', () => {
  test('mode=courses redirects to /courses/<courseId> when course has no started_at', async ({
    browser,
  }) => {
    test.skip(
      !env.notStartedCourseId || !env.notStartedSectionId || !env.notStartedAssetId,
      'TEST_COURSE_ID_NOT_STARTED / TEST_SECTION_ID_NOT_STARTED / TEST_ASSET_ID_NOT_STARTED required (seed a course with started_at=null)'
    );

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();

    const target = assetUrl(
      'courses',
      env.notStartedCourseId,
      env.notStartedSectionId,
      env.notStartedAssetId
    );
    await page.goto(target);

    await expect(page).toHaveURL(
      new RegExp(`/courses/${env.notStartedCourseId}(\\?|$|/)`),
      { timeout: 20000 }
    );

    await context.close();
  });

  test('mode=preview redirects to /preview/<courseId> when course has no started_at', async ({
    browser,
  }) => {
    test.skip(
      !env.notStartedCourseId || !env.notStartedSectionId || !env.notStartedAssetId,
      'TEST_COURSE_ID_NOT_STARTED / TEST_SECTION_ID_NOT_STARTED / TEST_ASSET_ID_NOT_STARTED required (and the seeded user must have studio=true so the preview branch is reachable)'
    );

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();

    const target = assetUrl(
      'preview',
      env.notStartedCourseId,
      env.notStartedSectionId,
      env.notStartedAssetId
    );
    await page.goto(target);

    await expect(page).toHaveURL(
      new RegExp(`/preview/${env.notStartedCourseId}(\\?|$|/)`),
      { timeout: 20000 }
    );

    await context.close();
  });
});

// ===========================================================================
// 5. Server-side redirects — verify-call failure clears cookies (SSP:127-140)
// ===========================================================================
// When the verify call against /user/profile throws (or returns non-OK and
// refresh is unavailable), the catch block clears all auth cookies and
// redirects to /auth/signIn. We trigger it by planting a garbage accessToken
// with NO refreshToken — middleware lets the request through (cookie present),
// SSP's verify returns 401, the refresh branch is skipped (refreshToken
// absent), the throw fires, and the catch path runs.
test.describe('Server-side redirects — invalid token catch block', () => {
  test('garbage accessToken with no refreshToken is cleared and user is redirected to /auth/signIn', async ({
    browser,
    baseURL,
  }) => {
    test.skip(!baseURL, 'baseURL required');

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await context.addCookies([
      {
        name: 'accessToken',
        value: 'not-a-real-token',
        domain: new URL(baseURL!).hostname,
        path: '/',
        httpOnly: false,
      },
    ]);
    const page = await context.newPage();

    const target = assetUrl('courses', PLACEHOLDER_UUID, PLACEHOLDER_UUID, PLACEHOLDER_UUID);
    await page.goto(target);

    await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 20000 });

    // Proves the catch block actually executed (SSP:128-133) — a plain
    // middleware redirect wouldn't touch the cookie. If the cookie survives,
    // the user would be stuck in a re-redirect loop on next navigation.
    const cookies = await context.cookies();
    const accessTokenCookie = cookies.find((c) => c.name === 'accessToken');
    expect(accessTokenCookie?.value ?? '').toBe('');

    await context.close();
  });
});

// ===========================================================================
// 6. Real-backend happy path
// ===========================================================================
// With a valid mode, a started course, and the right asset/section, the SSP
// resolves with no redirect and the page renders. We assert URL stability +
// course-name resolution via the document <title> (NextSeo writes the course
// name into <title>, sourced from the real /o/course/<id> response). This is
// the cheapest real-backend assertion that proves the data round-trip worked
// without coupling to the inner asset renderer.
test.describe('Real backend — asset page renders for a started course', () => {
  test('mode=courses with a started course stays on the asset URL and resolves the SEO title', async ({
    browser,
  }) => {
    test.skip(
      !env.courseId || !env.sectionId || !env.assetId,
      'TEST_COURSE_ID / TEST_SECTION_ID / TEST_ASSET_ID required (started course readable by the global user)'
    );

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();

    const target = assetUrl('courses', env.courseId, env.sectionId, env.assetId);

    // Anchor on the real /o/course/<id> GET — registering BEFORE goto so the
    // listener doesn't attach after the response has already fired (webkit
    // races this otherwise).
    const courseFetched = page.waitForResponse(
      (res) =>
        new RegExp(`/o/course/${env.courseId}(\\?|$)`).test(res.url()) &&
        res.request().method() === 'GET' &&
        res.status() < 400,
      { timeout: 20000 }
    );
    await page.goto(target);
    await courseFetched;

    // Did NOT redirect away from the asset URL.
    await expect(page).toHaveURL(new RegExp(target.replace(/\//g, '\\/')), { timeout: 10000 });

    // SEO title was populated from the course response (NextSeo sets
    // <title> from details?.data?.name via HtmlMarkdownToText). A non-empty
    // title proves the SSR + client query both succeeded.
    await expect.poll(() => page.title(), { timeout: 10000 }).not.toBe('');

    await context.close();
  });

  // mode=preview routes through STUDIO_API_URL on the server (SSP:92-93).
  // That switch happens in getServerSideProps, so the browser can't observe
  // which upstream URL Next.js called — we assert the end-to-end consequence
  // instead: the preview branch resolves a started course without redirect.
  test('mode=preview with a started course stays on the asset URL (proves studio-API branch resolves end-to-end)', async ({
    browser,
  }) => {
    test.skip(
      !env.courseId || !env.sectionId || !env.assetId,
      'TEST_COURSE_ID / TEST_SECTION_ID / TEST_ASSET_ID required (the global user must also have studio=true; if not, this branch hits /403 — covered separately in §3)'
    );

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();

    const target = assetUrl('preview', env.courseId, env.sectionId, env.assetId);
    await page.goto(target);

    // Confirm the page did NOT redirect to /403 (studio gate), to
    // /preview/<id> (not-started gate), or to /auth/signIn (auth failure).
    // Each of those means the studio-API branch did not resolve cleanly.
    await expect(page).not.toHaveURL(FORBIDDEN_URL_RE, { timeout: 10000 });
    await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 5000 });
    await expect(page).toHaveURL(new RegExp(target.replace(/\//g, '\\/')), { timeout: 10000 });

    await context.close();
  });
});
