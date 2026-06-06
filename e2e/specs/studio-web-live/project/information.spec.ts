/**
 * Project Information — real-backend smoke spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/information/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. ?tab=
 * default branching, individual tab content, and form interactions live in the
 * mocked sibling at tests/studio-web/project/information.spec.ts.
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

const informationUrl = (uuid: string) => `/studio/project/${uuid}/information`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);

const informationTitle = (p: Page) =>
  p.getByRole('heading', { name: /^information$/i });
const objectivesTab = (p: Page) => p.getByRole('tab', { name: /objectives/i });
const prerequisitesTab = (p: Page) => p.getByRole('tab', { name: /prerequisites/i });
const targetAudienceTab = (p: Page) => p.getByRole('tab', { name: /target audience/i });
const skillsTab = (p: Page) => p.getByRole('tab', { name: /skills/i });

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
  test('unauthenticated GET /studio/project/<uuid>/information redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(informationUrl(env.projectUuid));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — information page renders
// ===========================================================================
test.describe('Real backend — information page renders', () => {
  test('authenticated GET resolves course details and shows all four tabs', async ({
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
      await page.goto(informationUrl(env.projectUuid));
      await courseFetched;

      await expect(informationTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(objectivesTab(page)).toBeVisible();
      await expect(prerequisitesTab(page)).toBeVisible();
      await expect(targetAudienceTab(page)).toBeVisible();
      await expect(skillsTab(page)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
