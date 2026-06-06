/**
 * Shared Projects List — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/shared-projects/index.tsx
 *         GET /o/course/projects/authorized?... (list of projects shared with
 *         the current user from other orgs)
 *
 * Scope: only behaviors a real browser + real backend can verify. Filter chips,
 * empty-state copy, and pagination button states live in the mocked sibling at
 * tests/studio-web/shared-projects/shared-projects-list.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 */

import { test, expect } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const SHARED_URL = '/studio/shared-projects';
const SHARED_LIST_ENDPOINT_RE = /\/o\/course\/projects\/authorized\?/;

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
  test('unauthenticated GET /studio/shared-projects redirects to /auth/signIn', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(SHARED_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — shared-projects page resolves end-to-end
// ===========================================================================
// We anchor on the network response rather than a DOM heading because the
// page header is shared with /studio/projects (same "Projects" title) and
// could shift. The URL stability + the authorized-endpoint resolving is the
// observable contract.
test.describe('Real backend — shared-projects page renders', () => {
  test('authenticated GET resolves /o/course/projects/authorized without redirect', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const listFetched = page.waitForResponse(
        (r) =>
          SHARED_LIST_ENDPOINT_RE.test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(SHARED_URL);
      await listFetched;

      await expect(page).toHaveURL(/\/studio\/shared-projects/, { timeout: 10000 });
      await expect(page).not.toHaveURL(SIGN_IN_URL_RE, { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /o/course/projects/authorized
// ===========================================================================
test.describe('Contract — /o/course/projects/authorized', () => {
  test('GET returns 2xx with data:[] and meta.{total,page,size}', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) => SHARED_LIST_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(SHARED_URL);
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
        // Shared-projects tiles depend on the owner subtree to render the
        // "shared by <org>" label; the page silently breaks without it.
        expect(first).toHaveProperty('owner');
        expect(first.owner).toHaveProperty('domain');
      }
    } finally {
      await ctx.close();
    }
  });
});
