/**
 * Dashboard — real-backend smoke & contract spec.
 *
 * Scope: only behaviors that nothing other than a real browser + real backend
 * can verify. UI-rendering branches (empty state, carousel arrows, badge count)
 * live in the mocked sibling: tests/ui/dashboard/dashboard.spec.ts.
 *
 * Required env:
 *   BASE_URL                         — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD       — used by global-setup (signed-in session)
 *
 * Optional (each unlocks one real-flow test):
 *   TEST_EMAIL_DASHBOARD             — fully-onboarded user → /dashboard
 *   TEST_PASSWORD_DASHBOARD
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DASHBOARD_URL = '/dashboard';
const DASHBOARD_URL_RE = /\/dashboard(\?|$|\/)/;
const SIGN_IN_URL_RE = /\/auth\/signIn/;

const ASSIGNED_ENDPOINT_RE = /\/general\/dashboard\/courses\/assigned/;
const COMPLETED_ENDPOINT_RE = /\/general\/dashboard\/courses\/completed/;
const SUGGESTIONS_ENDPOINT_RE = /\/general\/dashboard\/courses\?/;

const TXT = {
  assignedTitle: 'Courses assigned to you!',
  completedTitle: "Courses you've Completed!",
  availableTitle: 'Available Courses',
  seeCatalog: 'See the entire catalog',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const assignedTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.assignedTitle, exact: true });
const completedTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.completedTitle, exact: true });
const availableTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.availableTitle, exact: true });
const seeCatalogButton = (p: Page) =>
  p.getByRole('button', { name: TXT.seeCatalog, exact: true });

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
// Pin language so heading-text locators don't silently miss against a
// French/other deployment.
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
  test('authenticated GET /dashboard renders the three section titles', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await expect(page).toHaveURL(DASHBOARD_URL_RE, { timeout: 20000 });

    await expect(assignedTitle(page)).toBeVisible({ timeout: 20000 });
    await expect(completedTitle(page)).toBeVisible();
    await expect(availableTitle(page)).toBeVisible();
  });
});

// ===========================================================================
// 2. Server-side redirects (middleware + getServerSideProps)
// ===========================================================================
test.describe('Server-side redirects', () => {
  test('unauthenticated GET /dashboard redirects to /auth/signIn', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      await page.goto(DASHBOARD_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 20000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — dashboard APIs the page consumes
//
// These canaries shape-check the real backend responses the dashboard renders.
// If the backend renames a field or changes nesting, these fail before the
// mocked rendering tests start lying.
// ===========================================================================
test.describe('Contract — /general/dashboard/courses', () => {
  test('GET /general/dashboard/courses/assigned returns 2xx with data + meta', async ({ page }) => {
    const resp = page.waitForResponse(
      (r) => ASSIGNED_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20000 }
    );

    await page.goto(DASHBOARD_URL);
    const res = await resp;

    expect(res.status()).toBeLessThan(400);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('meta');
  });

  test('GET /general/dashboard/courses/completed returns 2xx with data + meta', async ({ page }) => {
    const resp = page.waitForResponse(
      (r) => COMPLETED_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20000 }
    );

    await page.goto(DASHBOARD_URL);
    const res = await resp;

    expect(res.status()).toBeLessThan(400);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /general/dashboard/courses?… (suggestions) returns 2xx with data', async ({ page }) => {
    const resp = page.waitForResponse(
      (r) => SUGGESTIONS_ENDPOINT_RE.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20000 }
    );

    await page.goto(DASHBOARD_URL);
    const res = await resp;

    expect(res.status()).toBeLessThan(400);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('dashboard fires the assigned request with size=10&page=0', async ({ page }) => {
    const req = page.waitForRequest(
      (r) =>
        r.method() === 'GET' &&
        ASSIGNED_ENDPOINT_RE.test(r.url()) &&
        r.url().includes('size=10') &&
        r.url().includes('page=0'),
      { timeout: 20000 }
    );

    await page.goto(DASHBOARD_URL);
    await req;
  });
});

// ===========================================================================
// 4. Real-backend navigation
// ===========================================================================
test.describe('Real backend — navigation', () => {
  test('"See the entire catalog" navigates to /courses?tab=assigned-courses', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await expect(seeCatalogButton(page)).toBeVisible({ timeout: 20000 });

    await seeCatalogButton(page).click();
    await expect(page).toHaveURL(/\/courses\?tab=assigned-courses/, { timeout: 20000 });
  });
});
