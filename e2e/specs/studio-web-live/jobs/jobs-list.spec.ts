/**
 * Jobs List — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/jobs/index.tsx
 *         studio-web/src/api/hooks/jobs.ts (GET /o/jobs?...)
 *
 * Scope: only behaviors a real browser + real backend can verify. Add/edit/
 * delete row flows, translations expand, search debounce and Sync Global Jobs
 * mutation live in the mocked sibling at tests/studio-web/jobs/jobs-list.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const JOBS_URL = '/studio/jobs';
const JOBS_LIST_ENDPOINT_RE = /\/o\/jobs(\?|$)/;

const TXT = {
  syncGlobalBtn: /sync global jobs/i,
};

const syncGlobalButton = (p: Page) =>
  p.getByRole('button', { name: TXT.syncGlobalBtn });

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
  test('unauthenticated GET /studio/jobs redirects to /auth/signIn', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(JOBS_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — jobs page renders
// ===========================================================================
test.describe('Real backend — jobs page renders', () => {
  test('authenticated GET resolves /o/jobs and shows the Sync Global Jobs button', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const listFetched = page.waitForResponse(
        (r) =>
          JOBS_LIST_ENDPOINT_RE.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(JOBS_URL);
      await listFetched;

      await expect(syncGlobalButton(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /o/jobs
// ===========================================================================
// The page iterates over `data[]` and reads `meta.total` for pagination.
// If the backend renames or unwraps these, the mocked tests stay green while
// production breaks.
test.describe('Contract — /o/jobs', () => {
  test('GET /o/jobs returns 2xx with data:[] and the meta shape the list paginator consumes', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) => JOBS_LIST_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(JOBS_URL);
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(Array.isArray(body?.data)).toBe(true);
      // Real backend uses { current, items, number, pages, size }. `items` is
      // the total row count, `pages` is the total page count, `current` is
      // the 0-based current page. This differs from the {total,page,size}
      // shape the mocked sibling assumes.
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('items');
      expect(body.meta).toHaveProperty('pages');
      expect(body.meta).toHaveProperty('current');
      expect(body.meta).toHaveProperty('size');

      // Sanity-check row shape only if there's at least one row.
      if (body.data.length > 0) {
        const first = body.data[0];
        expect(first).toHaveProperty('uuid');
        expect(first).toHaveProperty('key');
      }
    } finally {
      await ctx.close();
    }
  });
});
