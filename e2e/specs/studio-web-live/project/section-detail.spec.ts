/**
 * Section Detail — real-backend smoke spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/section/[sectionId]/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. Delete-modal
 * confirm/cancel, edit-mode toggle, and missing-section rendering live in the
 * mocked sibling at tests/studio-web/project/section-detail.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 *
 * Optional (this pair must point at a section that belongs to the project):
 *   TEST_STUDIO_PROJECT_UUID
 *   TEST_STUDIO_SECTION_ID
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  projectUuid: process.env.TEST_STUDIO_PROJECT_UUID ?? '',
  sectionId: process.env.TEST_STUDIO_SECTION_ID ?? '',
};

const sectionUrl = (uuid: string, sid: string) =>
  `/studio/project/${uuid}/section/${sid}`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);

const sectionTitle = (p: Page) =>
  p.getByRole('heading', { name: /^section$/i });

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
  test('unauthenticated GET /studio/project/<uuid>/section/<sid> redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid || !env.sectionId,
      'TEST_STUDIO_PROJECT_UUID / TEST_STUDIO_SECTION_ID required'
    );

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(sectionUrl(env.projectUuid, env.sectionId));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — section page renders
// ===========================================================================
// The section is resolved client-side by finding sectionId in details.sections.
// We assert the Section title appears (proves the layout mounted) and that the
// real backend returned a section matching the env sectionId.
test.describe('Real backend — section page renders', () => {
  test('authenticated GET resolves the section and shows the Section title', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid || !env.sectionId,
      'TEST_STUDIO_PROJECT_UUID / TEST_STUDIO_SECTION_ID required (section must belong to project)'
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
      await page.goto(sectionUrl(env.projectUuid, env.sectionId));
      const res = await courseFetched;

      const body = await res.json();
      const found = body?.data?.sections?.some((s: any) => s?.uuid === env.sectionId);
      expect(found).toBe(true);

      await expect(sectionTitle(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});
