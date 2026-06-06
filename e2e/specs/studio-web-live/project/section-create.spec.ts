/**
 * Section Create — real-backend smoke spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/section/create.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. Save-disabled
 * state, POST body shape, Cancel navigation, and form interactions live in the
 * mocked sibling at tests/studio-web/project/section-create.spec.ts.
 *
 * This spec deliberately does NOT submit the create form against the real
 * backend — that would mutate state (leaving orphan test sections behind on
 * the deployment). Mutation paths are owned by the mocked sibling.
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

const createUrl = (uuid: string) => `/studio/project/${uuid}/section/create`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);

const sectionNameInput = (p: Page) => p.getByRole('textbox').first();
const saveButton = (p: Page) => p.getByRole('button', { name: /^save$/i });
const cancelButton = (p: Page) => p.getByRole('button', { name: /^cancel$/i });

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
  test('unauthenticated GET /studio/project/<uuid>/section/create redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(!env.projectUuid, 'TEST_STUDIO_PROJECT_UUID required');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(createUrl(env.projectUuid));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — create page renders the form
// ===========================================================================
test.describe('Real backend — section create page renders', () => {
  test('authenticated GET resolves course details and shows the section-name input plus Save/Cancel', async ({
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
      await page.goto(createUrl(env.projectUuid));
      await courseFetched;

      await expect(sectionNameInput(page)).toBeVisible({ timeout: 10000 });
      await expect(saveButton(page)).toBeVisible();
      await expect(cancelButton(page)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
