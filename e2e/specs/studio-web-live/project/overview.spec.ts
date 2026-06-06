/**
 * Project Overview — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/overview.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. UI-rendering
 * branches (translation alert variants, setup_incomplete_for warning, Next-button
 * navigation) live in the mocked sibling at tests/studio-web/project/overview.spec.ts.
 *
 * Required env (see ardoise-tests/.env):
 *   BASE_URL                          — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD        — global-setup session
 *
 * Optional (each unlocks one real-flow test):
 *   TEST_STUDIO_PROJECT_UUID          — UUID of a project the global user owns
 *                                       (used to hit the real /o/course/projects/<uuid>
 *                                       endpoint and confirm the page renders)
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  projectUuid: process.env.TEST_STUDIO_PROJECT_UUID ?? '',
};

const overviewUrl = (uuid: string) => `/studio/project/${uuid}/overview`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);
const translateStatusEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}/translate/status(\\?|$)`);

const TXT = {
  nextBtn: 'Next',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const nextButton = (p: Page) =>
  p.getByRole('button', { name: TXT.nextBtn, exact: true });

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
// Pin language so any text-based locator stays stable against a French/other
// deployment default.
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
// studio-web/src/middleware.ts redirects any non-public path to /auth/signIn
// when no session cookie is present. The overview page is not in PUBLIC_PREFIXES.
test.describe('Server-side redirects — auth', () => {
  test('unauthenticated GET /studio/project/<uuid>/overview redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(overviewUrl(env.projectUuid));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — overview page resolves end-to-end
// ===========================================================================
// With a valid project UUID the global user owns, the page should fetch course
// details + translate-status, and render the "Next" button (which only appears
// once course details resolve). This is the cheapest real-backend assertion
// that proves the data round-trip + render handshake worked.
test.describe('Real backend — overview page renders', () => {
  test('authenticated GET resolves course details and shows the Next button', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid,
      'TEST_STUDIO_PROJECT_UUID required (a project the global user owns)'
    );

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      // Anchor on the real course-details GET. Register BEFORE goto so the
      // listener doesn't attach after the response has already fired.
      const courseFetched = page.waitForResponse(
        (r) =>
          courseDetailsEndpointRe(env.projectUuid).test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(overviewUrl(env.projectUuid));
      await courseFetched;

      await expect(page).toHaveURL(new RegExp(`/project/${env.projectUuid}/overview`), {
        timeout: 10000,
      });
      await expect(nextButton(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — endpoints the overview page consumes
// ===========================================================================
// Shape-check the real responses. If the backend renames a field or wraps the
// payload differently, these fire before the mocked tests start lying.
test.describe('Contract — /o/course/projects/<uuid>', () => {
  test('GET /o/course/projects/<uuid> returns 2xx with data.{uuid,name,owner,sections}', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) =>
          courseDetailsEndpointRe(env.projectUuid).test(r.url()) &&
          r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(overviewUrl(env.projectUuid));
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('uuid', env.projectUuid);
      expect(body.data).toHaveProperty('name');
      expect(body.data).toHaveProperty('owner');
      expect(body.data.owner).toHaveProperty('domain');
      expect(body.data).toHaveProperty('sections');
      expect(Array.isArray(body.data.sections)).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('GET /o/course/projects/<uuid>/translate/status returns 2xx with data.status', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) =>
          translateStatusEndpointRe(env.projectUuid).test(r.url()) &&
          r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(overviewUrl(env.projectUuid));
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('status');
    } finally {
      await ctx.close();
    }
  });
});
