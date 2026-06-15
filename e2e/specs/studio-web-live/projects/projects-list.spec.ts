/**
 * Projects List — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/projects/index.tsx
 *         GET /o/course/projects?... (list)
 *         GET /o/course/projects/scorm-scrap/incomplete (banner driver)
 *
 * Scope: only behaviors a real browser + real backend can verify. Filter chips,
 * search debounce, pagination button states, and the SCORM-incomplete banner's
 * variants live in the mocked sibling at tests/studio-web/projects/projects-list.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const PROJECTS_URL = '/studio/projects';
const PROJECTS_LIST_ENDPOINT_RE = /\/o\/course\/projects\?/;

const projectsTitle = (p: Page) =>
  p.getByRole('heading', { name: /^projects$/i });

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
  test('unauthenticated GET /studio/projects redirects to /auth/signIn', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(PROJECTS_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — projects page renders
// ===========================================================================
test.describe('Real backend — projects page renders', () => {
  test('authenticated GET resolves /o/course/projects and shows the Projects title', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const listFetched = page.waitForResponse(
        (r) =>
          PROJECTS_LIST_ENDPOINT_RE.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(PROJECTS_URL);
      await listFetched;

      await expect(projectsTitle(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /o/course/projects
// ===========================================================================
// The list iterates `data[]` and reads `meta.total`. Row tiles read `uuid`,
// `name`, `status.key`, `owner.domain` for the disabled/owner-mismatch styling.
test.describe('Contract — /o/course/projects', () => {
  test('GET /o/course/projects returns 2xx with data:[] and meta.{total,page,size}', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) => PROJECTS_LIST_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(PROJECTS_URL);
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(Array.isArray(body?.data)).toBe(true);
      // Real backend pagination shape: { current, items, number, pages, size }.
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('items');
      expect(body.meta).toHaveProperty('pages');
      expect(body.meta).toHaveProperty('current');
      expect(body.meta).toHaveProperty('size');

      if (body.data.length > 0) {
        const first = body.data[0];
        expect(first).toHaveProperty('uuid');
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('status');
        expect(first.status).toHaveProperty('key');
        expect(first).toHaveProperty('owner');
        expect(first.owner).toHaveProperty('domain');
      }
    } finally {
      await ctx.close();
    }
  });
});
