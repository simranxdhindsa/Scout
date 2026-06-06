/**
 * Skills Lab Dashboard — real-backend smoke & contract spec.
 *
 * Scope: only behaviors that nothing other than a real browser + real backend
 * can verify. UI-rendering branches (empty state, carousel, per-subType
 * payload overrides) live in the mocked sibling:
 *   tests/ui/skills-lab/dashboard.spec.ts
 *
 * Required env:
 *   BASE_URL                         — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD       — used by global-setup (signed-in session)
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SKILLS_LAB_URL = '/skills-lab/dashboard';
const SKILLS_LAB_URL_RE = /\/skills-lab\/dashboard(\?|$|\/)/;
const SIGN_IN_URL_RE = /\/auth\/signIn/;

const SKILLS_LAB_ENDPOINT_RE = /\/general\/dashboard\/courses\/skills-lab/;

const SUB_TYPES = ['try-me', 'guide-me', 'mentor-me'] as const;
type SubType = (typeof SUB_TYPES)[number];

const TXT = {
  tryMeTitle: 'Try Me',
  guideMeTitle: 'Guide Me',
  mentorMeTitle: 'Mentor Me',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const tryMeTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.tryMeTitle, exact: true });
const guideMeTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.guideMeTitle, exact: true });
const mentorMeTitle = (p: Page) =>
  p.getByRole('heading', { name: TXT.mentorMeTitle, exact: true });

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
  test('authenticated GET /skills-lab/dashboard renders all three section titles', async ({ page }) => {
    await page.goto(SKILLS_LAB_URL);
    await expect(page).toHaveURL(SKILLS_LAB_URL_RE, { timeout: 20000 });

    await expect(tryMeTitle(page)).toBeVisible({ timeout: 20000 });
    await expect(guideMeTitle(page)).toBeVisible();
    await expect(mentorMeTitle(page)).toBeVisible();
  });
});

// ===========================================================================
// 2. Server-side redirects
// ===========================================================================
test.describe('Server-side redirects', () => {
  test('unauthenticated GET /skills-lab/dashboard redirects to /auth/signIn', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      await page.goto(SKILLS_LAB_URL);
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 20000 });
    } finally {
      await ctx.close();
    }
  });
});

// ===========================================================================
// 3. Contract — /general/dashboard/courses/skills-lab
//
// The page fires three calls to the same endpoint, distinguished by
// `subType=try-me|guide-me|mentor-me`. Each canary shape-checks one subType.
// ===========================================================================
test.describe('Contract — /general/dashboard/courses/skills-lab', () => {
  for (const subType of SUB_TYPES) {
    test(`GET …/skills-lab?subType=${subType} returns 2xx with data + meta`, async ({ page }) => {
      const resp = page.waitForResponse(
        (r) =>
          r.request().method() === 'GET' &&
          SKILLS_LAB_ENDPOINT_RE.test(r.url()) &&
          new RegExp(`[?&]subType=${subType}(&|$)`).test(r.url()),
        { timeout: 20000 }
      );

      await page.goto(SKILLS_LAB_URL);
      const res = await resp;

      expect(res.status()).toBeLessThan(400);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('meta');
    });
  }

  test('all three subType requests fire on a single page load', async ({ page }) => {
    const seen = new Set<SubType>();
    page.on('request', (r) => {
      if (r.method() !== 'GET' || !SKILLS_LAB_ENDPOINT_RE.test(r.url())) return;
      const match = r.url().match(/[?&]subType=([^&]+)/);
      const subType = match?.[1] as SubType | undefined;
      if (subType && (SUB_TYPES as readonly string[]).includes(subType)) {
        seen.add(subType);
      }
    });

    await page.goto(SKILLS_LAB_URL);
    await expect.poll(() => seen.size, { timeout: 20000 }).toBe(3);
    expect(seen).toEqual(new Set(SUB_TYPES));
  });
});
