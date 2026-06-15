/**
 * Project Topics List — real-backend smoke spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/topics-list/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. Auto-open
 * AddTopic form when topics are empty, validation, and POST contract live in
 * the mocked sibling at tests/studio-web/project/topics-list.spec.ts.
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

const topicsUrl = (uuid: string) => `/studio/project/${uuid}/topics-list`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);

const topicsTitle = (p: Page) =>
  p.getByRole('heading', { name: /^topics$/i });

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
  test('unauthenticated GET /studio/project/<uuid>/topics-list redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(topicsUrl(env.projectUuid));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — topics page renders
// ===========================================================================
test.describe('Real backend — topics page renders', () => {
  test('authenticated GET resolves course details and shows the Topics title', async ({
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
      await page.goto(topicsUrl(env.projectUuid));
      await courseFetched;

      await expect(topicsTitle(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — topics field in course details
// ===========================================================================
test.describe('Contract — /o/course/projects/<uuid>.data.topics', () => {
  test('data.topics is an array (page iterates over it)', async ({ browser }) => {
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
      await page.goto(topicsUrl(env.projectUuid));
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(Array.isArray(body?.data?.topics)).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
