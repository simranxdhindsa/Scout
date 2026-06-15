/**
 * Skills List — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/skills/index.tsx
 *         studio-web/src/api/hooks/skills.ts (GET /o/skills?...)
 *
 * Scope: only behaviors a real browser + real backend can verify. Row CRUD,
 * translations expand, search debounce, and Sync Global Skills mutation live
 * in the mocked sibling at tests/studio-web/skills/skills-list.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const SKILLS_URL = '/studio/skills';
const SKILLS_LIST_ENDPOINT_RE = /\/o\/skills(\?|$)/;

const TXT = {
  syncGlobalBtn: /sync global skills/i,
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
  test('unauthenticated GET /studio/skills redirects to /auth/signIn', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(SKILLS_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — skills page renders
// ===========================================================================
test.describe('Real backend — skills page renders', () => {
  test('authenticated GET resolves /o/skills and shows the Sync Global Skills button', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const listFetched = page.waitForResponse(
        (r) =>
          SKILLS_LIST_ENDPOINT_RE.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(SKILLS_URL);
      await listFetched;

      await expect(syncGlobalButton(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /o/skills
// ===========================================================================
test.describe('Contract — /o/skills', () => {
  test('GET /o/skills returns 2xx with data:[] and meta.{total,page,size}', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) => SKILLS_LIST_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(SKILLS_URL);
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(Array.isArray(body?.data)).toBe(true);
      // Real backend uses { current, items, number, pages, size } — see the
      // jobs spec for context. The mocked sibling assumes {total,page,size}.
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('items');
      expect(body.meta).toHaveProperty('pages');
      expect(body.meta).toHaveProperty('current');
      expect(body.meta).toHaveProperty('size');

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
