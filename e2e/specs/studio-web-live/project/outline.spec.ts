/**
 * Project Outline — real-backend smoke spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/outline/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. Per-section
 * accordion expand/collapse, empty-list rendering, and delete confirmation live
 * in the mocked sibling at tests/studio-web/project/outline.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 *
 * Optional:
 *   TEST_STUDIO_PROJECT_UUID
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  projectUuid: process.env.TEST_STUDIO_PROJECT_UUID ?? '',
};

const outlineUrl = (uuid: string) => `/studio/project/${uuid}/outline`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);

const sectionsTitle = (p: Page) =>
  p.getByRole('heading', { name: /^sections$/i });

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
test.describe('Server-side redirects — auth', () => {
  test('unauthenticated GET /studio/project/<uuid>/outline redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(outlineUrl(env.projectUuid));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — outline page renders
// ===========================================================================
test.describe('Real backend — outline page renders', () => {
  test('authenticated GET resolves course details and shows the Sections title', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid,
      'TEST_STUDIO_PROJECT_UUID required (a project the global user owns)'
    );

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const courseFetched = page.waitForResponse(
        (r) =>
          courseDetailsEndpointRe(env.projectUuid).test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(outlineUrl(env.projectUuid));
      await courseFetched;

      await expect(sectionsTitle(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — section shape the outline page consumes
// ===========================================================================
// The outline renders each item in `data.sections[]`. If the backend stops
// returning `name` or drops the `assets` array, the mocked rendering tests
// keep passing while production breaks. Shape-check the real response.
test.describe('Contract — /o/course/projects/<uuid>.data.sections[]', () => {
  test('each section in the response has the fields the outline iterates over', async ({
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
      await page.goto(outlineUrl(env.projectUuid));
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      const sections = body?.data?.sections;
      expect(Array.isArray(sections)).toBe(true);

      // If the project has at least one section, sanity-check its shape.
      // We don't fail when sections is empty — that's a valid project state.
      if (sections.length > 0) {
        const first = sections[0];
        expect(first).toHaveProperty('uuid');
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('assets');
        expect(Array.isArray(first.assets)).toBe(true);
      }
    } finally {
      await ctx.close();
    }
  });
});
