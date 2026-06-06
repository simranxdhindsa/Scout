/**
 * Project Context — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/context/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. Tab-default
 * branching, ?tab= param handling, and owner-domain action gating live in the
 * mocked sibling at tests/studio-web/project/context.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 *
 * Optional:
 *   TEST_STUDIO_PROJECT_UUID          — project the global user owns
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  projectUuid: process.env.TEST_STUDIO_PROJECT_UUID ?? '',
};

const contextUrl = (uuid: string) => `/studio/project/${uuid}/context`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);

const projectContextTab = (p: Page) =>
  p.getByRole('tab', { name: /project context/i });
const orgContextTab = (p: Page) =>
  p.getByRole('tab', { name: /org context/i });

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
  test('unauthenticated GET /studio/project/<uuid>/context redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(contextUrl(env.projectUuid));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — context page renders for an owned project
// ===========================================================================
// useCourseDisabled is only `false` when owner.domain matches the BASE_URL
// subdomain; tabs render only when actions aren't disabled. So a passing test
// here implies both endpoints resolved AND ownership matched.
test.describe('Real backend — context page renders', () => {
  test('authenticated GET resolves course details and shows both context tabs', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid,
      'TEST_STUDIO_PROJECT_UUID required (a project the global user owns; tabs are hidden otherwise)'
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
      await page.goto(contextUrl(env.projectUuid));
      await courseFetched;

      await expect(projectContextTab(page)).toBeVisible({ timeout: 10000 });
      await expect(orgContextTab(page)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('?tab=org-context selects the Org Context tab from a real navigation', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      await page.goto(`${contextUrl(env.projectUuid)}?tab=org-context`);
      await expect(orgContextTab(page)).toHaveAttribute('aria-selected', 'true', {
        timeout: 15000,
      });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — endpoint the context page consumes
// ===========================================================================
test.describe('Contract — /o/course/projects/<uuid>', () => {
  test('GET /o/course/projects/<uuid> returns 2xx and the owner domain matches the BASE_URL subdomain', async ({
    browser,
    baseURL,
  }) => {
    test.skip(
      !env.projectUuid || !baseURL,
      'TEST_STUDIO_PROJECT_UUID and BASE_URL required'
    );

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) =>
          courseDetailsEndpointRe(env.projectUuid).test(r.url()) &&
          r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(contextUrl(env.projectUuid));
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      const subdomain = new URL(baseURL!).hostname.split('.')[0];
      // Ownership match is the contract behind tabs/actions being enabled.
      // If this assertion ever fails, the smoke test above will too.
      expect(body?.data?.owner?.domain).toBe(subdomain);
    } finally {
      await ctx.close();
    }
  });
});
