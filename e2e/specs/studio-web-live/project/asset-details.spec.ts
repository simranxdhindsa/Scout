/**
 * Asset Details — real-backend smoke & contract spec.
 *
 * Source: studio-web/src/pages/project/[uuid]/section/[sectionId]/asset/[assetId]/details/index.tsx
 *        + studio-web/src/features/courses/asset-details/index.tsx
 *
 * Scope: only behaviors a real browser + real backend can verify. Breadcrumb
 * variants when section/asset uuids are not found, settings/resources conditional
 * subtrees, and error toasting live in the mocked sibling at
 * tests/studio-web/project/asset-details.spec.ts.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD
 *
 * Optional (all three must point at an asset that actually belongs to the
 * project's section — they're consumed together by the deep route):
 *   TEST_STUDIO_PROJECT_UUID
 *   TEST_STUDIO_SECTION_ID
 *   TEST_STUDIO_ASSET_ID
 */

import { test, expect, Page } from '@playwright/test';

const SIGN_IN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  projectUuid: process.env.TEST_STUDIO_PROJECT_UUID ?? '',
  sectionId: process.env.TEST_STUDIO_SECTION_ID ?? '',
  assetId: process.env.TEST_STUDIO_ASSET_ID ?? '',
};

const assetUrl = (uuid: string, sid: string, aid: string) =>
  `/studio/project/${uuid}/section/${sid}/asset/${aid}/details`;
const courseDetailsEndpointRe = (uuid: string) =>
  new RegExp(`/o/course/projects/${uuid}(\\?|$)`);
const assetDetailsEndpointRe = (uuid: string, sid: string, aid: string) =>
  new RegExp(`/o/course/projects/${uuid}/section/${sid}/asset/${aid}(\\?|$)`);

const overviewTitle = (p: Page) =>
  p.getByRole('heading', { name: /^overview$/i });

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
  test('unauthenticated GET /studio/project/.../asset/.../details redirects to /auth/signIn', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid || !env.sectionId || !env.assetId,
      'TEST_STUDIO_PROJECT_UUID / TEST_STUDIO_SECTION_ID / TEST_STUDIO_ASSET_ID required'
    );

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    try {
      await page.goto(assetUrl(env.projectUuid, env.sectionId, env.assetId));
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 2. Real-backend smoke — asset details renders end-to-end
// ===========================================================================
// The page fires both /o/course/projects/<uuid> AND
// /o/course/projects/<uuid>/section/<sid>/asset/<aid>. Both must resolve before
// the Loader unmounts and the Overview heading paints. Asserting the heading
// proves the data round-trip + render handshake.
test.describe('Real backend — asset details renders', () => {
  test('authenticated GET resolves both course + asset endpoints and shows the Overview heading', async ({
    browser,
  }) => {
    test.skip(
      !env.projectUuid || !env.sectionId || !env.assetId,
      'TEST_STUDIO_PROJECT_UUID / TEST_STUDIO_SECTION_ID / TEST_STUDIO_ASSET_ID required (must point at a real asset inside a real section inside the project)'
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
      const assetFetched = page.waitForResponse(
        (r) =>
          assetDetailsEndpointRe(env.projectUuid, env.sectionId, env.assetId).test(r.url()) &&
          r.request().method() === 'GET' &&
          r.status() < 400,
        { timeout: 20000 }
      );
      await page.goto(assetUrl(env.projectUuid, env.sectionId, env.assetId));
      await Promise.all([courseFetched, assetFetched]);

      await expect(overviewTitle(page)).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — asset details endpoint shape
// ===========================================================================
// The page (and its child components) read `data.{uuid,name,type.key,settings}`
// from this response. If the backend renames any of these, the mocked tests
// stay green while production silently breaks.
test.describe('Contract — /o/course/projects/<uuid>/section/<sid>/asset/<aid>', () => {
  test('GET returns 2xx with data.{uuid,name,type.key,settings}', async ({ browser }) => {
    test.skip(
      !env.projectUuid || !env.sectionId || !env.assetId,
      'TEST_STUDIO_PROJECT_UUID / TEST_STUDIO_SECTION_ID / TEST_STUDIO_ASSET_ID required'
    );

    const ctx = await browser.newContext({ storageState: AUTH_STATE });
    const page = await ctx.newPage();
    try {
      const resp = page.waitForResponse(
        (r) =>
          assetDetailsEndpointRe(env.projectUuid, env.sectionId, env.assetId).test(r.url()) &&
          r.request().method() === 'GET',
        { timeout: 20000 }
      );
      await page.goto(assetUrl(env.projectUuid, env.sectionId, env.assetId));
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('uuid', env.assetId);
      expect(body.data).toHaveProperty('name');
      expect(body.data).toHaveProperty('type');
      expect(body.data.type).toHaveProperty('key');
      expect(body.data).toHaveProperty('settings');
    } finally {
      await ctx.close();
    }
  });
});
