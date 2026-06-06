/**
 * Bookmark Courses — real-backend smoke & contract spec.
 *
 * Scope: only behaviors that nothing other than a real browser + real backend
 * can verify. UI-rendering branches (empty state, pagination arrows, page-size
 * dropdown) live in the mocked sibling:
 *   tests/ui/bookmark/bookmark.spec.ts
 *
 * Required env:
 *   BASE_URL                         — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD       — used by global-setup (signed-in session)
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BOOKMARK_URL = '/bookmark';
const BOOKMARK_URL_RE = /\/bookmark(\?|$|\/)/;
const SIGN_IN_URL_RE = /\/auth\/signIn/;

const BOOKMARKS_ENDPOINT_RE = /\/user\/bookmarks/;

const TXT = {
  pageTitle: 'Bookmark Courses',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const pageTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.pageTitle, exact: true });

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
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
// 1. Smoke
// ===========================================================================
test.describe('Smoke', () => {
  test('authenticated GET /bookmark renders the page title', async ({ page }) => {
    await page.goto(BOOKMARK_URL);
    await expect(page).toHaveURL(BOOKMARK_URL_RE, { timeout: 20000 });
    await expect(pageTitle(page)).toBeVisible({ timeout: 20000 });
  });
});

// ===========================================================================
// 2. Server-side redirects
// ===========================================================================
test.describe('Server-side redirects', () => {
  test('unauthenticated GET /bookmark redirects to /auth/signIn', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      await page.goto(BOOKMARK_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 20000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /user/bookmarks
//
// CourseCard reads `bookmark.course.*`, not flat `bookmark.*`. If the backend
// flattens the shape or renames the wrapper, this canary catches it before
// mocked specs start lying.
// ===========================================================================
test.describe('Contract — /user/bookmarks', () => {
  test('GET /user/bookmarks returns 2xx with data + meta', async ({ page }) => {
    const resp = page.waitForResponse(
      (r) => BOOKMARKS_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20000 }
    );

    await page.goto(BOOKMARK_URL);
    const res = await resp;

    expect(res.status()).toBeLessThan(400);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('meta');
  });

  test('each bookmark entry exposes a nested `course` object with a uuid', async ({ page }) => {
    const resp = page.waitForResponse(
      (r) => BOOKMARKS_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20000 }
    );

    await page.goto(BOOKMARK_URL);
    const res = await resp;

    expect(res.status()).toBeLessThan(400);
    const body = await res.json();

    // If the user has no bookmarks, skip the shape check — there's nothing
    // to inspect. The smoke + status assertion above still pinned the contract.
    test.skip(
      !Array.isArray(body.data) || body.data.length === 0,
      'TEST_EMAIL user has no bookmarks; seed at least one bookmark to exercise the shape check'
    );

    const first = body.data[0];
    expect(first).toHaveProperty('course');
    expect(first.course).toHaveProperty('uuid');
  });

  test('GET /user/bookmarks forwards page/size from URL (?page=2&size=25 → page=1, size=25)', async ({ page }) => {
    const req = page.waitForRequest(
      (r) =>
        r.method() === 'GET' &&
        BOOKMARKS_ENDPOINT_RE.test(r.url()) &&
        r.url().includes('size=25') &&
        r.url().includes('page=1'),
      { timeout: 20000 }
    );

    await page.goto(`${BOOKMARK_URL}?page=2&size=25`);
    await req;
  });
});

// ===========================================================================
// 4. Real-backend pagination (URL-driven)
// ===========================================================================
test.describe('Real backend — URL-driven pagination', () => {
  test('?page=1 lands on the bookmark page with size=10 default', async ({ page }) => {
    const req = page.waitForRequest(
      (r) =>
        r.method() === 'GET' &&
        BOOKMARKS_ENDPOINT_RE.test(r.url()) &&
        r.url().includes('size=10') &&
        r.url().includes('page=0'),
      { timeout: 20000 }
    );

    await page.goto(BOOKMARK_URL);
    await req;
    await expect(pageTitle(page)).toBeVisible({ timeout: 20000 });
  });
});
