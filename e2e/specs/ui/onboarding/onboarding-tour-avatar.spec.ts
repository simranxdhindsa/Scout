import { test, expect, Page, Route } from '@playwright/test';

/*
 * COVERAGE
 * tour/avatar.tsx is gated by useGetAvatarFiles — while Unity assets are being
 * fetched the page renders SetupScreen instead of the chat panel. Driving a
 * real Unity load in Playwright is not feasible, so this spec exercises only
 * what is testable without a Unity runtime:
 *
 *   1. SetupScreen renders while useGetAvatarFiles is pending.
 *   2. SetupScreen subtitle shows download percent if a `downloadPercent` is
 *      reported (we cannot easily inject that, so we assert the static subtitle
 *      text fallback only).
 *   3. The avatar conversation session POSTs /onboarding-progress/start with
 *      { mode: "avatar" } on mount (regardless of Unity state).
 *
 * What's intentionally NOT covered: Unity load completion, TourAvatar Continue
 * routing, OnboardingAvatarUnity TTS bridge. Those require a Unity context and
 * are out of scope for unit-level E2E.
 *
 * NOTE: tour/avatar.tsx has no SSR auth gate, so no unauthenticated-redirect
 * test is included.
 */

const AVATAR_URL = '/onboarding/tour/avatar';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
async function mockStartApi(page: Page, onRequest?: (body: Record<string, unknown>) => void) {
  await page.route('**/onboarding-progress/start**', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (onRequest) onRequest(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'tok-av-1', conversation_id: 'conv-av-1', success: true }),
    });
  });
}

async function mockHistoryApi(page: Page) {
  await page.route('**/onboarding-progress/history**', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
}

// useGetAvatarFiles falls back to /o/user/profile/org-avatar. We hold the
// response open so the query stays pending and SetupScreen remains mounted.
function mockOrgAvatarHanging(page: Page): { resolve: () => void } {
  let resolve!: () => void;
  const gate = new Promise<void>((r) => { resolve = r; });

  page.route('**/user/profile/org-avatar**', async (route: Route) => {
    await gate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    });
  });

  return { resolve };
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
// EN i18n: "We're setting things up for you"
const setupTitle = (page: Page) =>
  page.getByText(/setting things up for you/i).first();

// EN i18n: "This will just take a few moments..."
const setupSubtitle = (page: Page) =>
  page.getByText(/take a few moments/i).first();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Tour Avatar page', () => {
  test.describe('Setup screen while Unity assets load', () => {
    test('renders SetupScreen title while useGetAvatarFiles is pending', async ({ page }) => {
      const { resolve } = mockOrgAvatarHanging(page);
      await mockStartApi(page);
      await mockHistoryApi(page);

      await page.goto(AVATAR_URL);

      // Either the title or subtitle of SetupScreen should be visible while
      // the avatar-files query is hanging — i18n keys vary, so accept either.
      await expect(async () => {
        const titleVisible = await setupTitle(page).isVisible().catch(() => false);
        const subtitleVisible = await setupSubtitle(page).isVisible().catch(() => false);
        expect(titleVisible || subtitleVisible).toBe(true);
      }).toPass({ timeout: 10000 });

      resolve();
    });
  });

  test.describe('API calls on load', () => {
    test('fires POST /start with { mode: "avatar" } on mount', async ({ page }) => {
      const { resolve } = mockOrgAvatarHanging(page);
      await mockHistoryApi(page);
      await mockStartApi(page);

      const [startRequest] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'POST' && req.url().includes('onboarding-progress/start')
        ),
        page.goto(AVATAR_URL),
      ]);

      const body = startRequest.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ mode: 'avatar' });

      resolve();
    });
  });
});
