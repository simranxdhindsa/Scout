/**
 * Knowledge Bases List — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/knowledge-bases/index.tsx
 *         studio-web/src/api/hooks/knowledge-bases.ts
 *         GET /o/org/knowledge-bases/manage?... (list)
 *
 * Scope: only behaviors a real browser + real backend can verify. Create-KB
 * modal flow, file upload, access-rules drawer, and pagination live in
 * component / mocked tests. There is no mocked sibling for this page yet —
 * write one alongside if mocked rendering coverage is needed.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 */

import { test, expect } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const KB_URL = '/studio/knowledge-bases';
const KB_LIST_ENDPOINT_RE = /\/o\/org\/knowledge-bases\/manage(\?|$)/;

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
  test('unauthenticated GET /studio/knowledge-bases redirects to /auth/signIn', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(KB_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — knowledge-bases page resolves end-to-end
// ===========================================================================
test.describe('Real backend — knowledge-bases page renders', () => {
  test('authenticated GET resolves /o/org/knowledge-bases/manage without redirect', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const listFetched = page.waitForResponse(
        (r) =>
          KB_LIST_ENDPOINT_RE.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(KB_URL);
      await listFetched;

      await expect(page).toHaveURL(/\/studio\/knowledge-bases/, { timeout: 10000 });
      await expect(page).not.toHaveURL(SIGN_IN_URL_RE, { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /o/org/knowledge-bases/manage
// ===========================================================================
test.describe('Contract — /o/org/knowledge-bases/manage', () => {
  test('GET returns 2xx with data:[] and meta.{total,page,size}', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) => KB_LIST_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(KB_URL);
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
      }
    } finally {
      await ctx.close();
    }
  });
});
