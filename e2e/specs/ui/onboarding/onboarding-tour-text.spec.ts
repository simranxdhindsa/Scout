import { test, expect, Page, Route } from '@playwright/test';

/*
 * ASSUMPTIONS
 * 1. Auth is handled globally by playwright.config.ts storageState (set in globalSetup).
 * 2. On mount the page fires POST **\/user-onboarding-progress\/start** with body { mode: "text" }.
 * 3. Immediately after, it fires POST **\/user-onboarding-progress\/history** to hydrate the chat.
 * 4. The Continue button is absent/hidden until history[0].answer is parseable JSON with action="finished".
 * 5. All network calls are mocked — no real backend is required.
 * 6. Tests are parallel-safe; each test runs in its own page context via Playwright fixtures.
 * 7. If Continue routing breaks, the first suspect is the ?redirect=summary param being dropped.
 *
 * LOCATOR MAP
 * chatCard        — [data-onboarding-chat-card]  (data attribute on the chat container)
 * continueButton  — role=button name="Continue"  (preferred); fallback xpath below
 * chatScroller    — #onboardingScrollableDiv       (id on the scrollable history div)
 *
 * RECOMMENDED DATA-TESTID HOOKS (ask app team to add if selectors become flaky):
 *   data-testid="onboarding-continue-btn"   on the Continue button
 *   data-testid="onboarding-chat-card"      on the chat container root
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TEXT_URL = '/onboarding/tour/text';

// ---------------------------------------------------------------------------
// Selector map
// ---------------------------------------------------------------------------
const SELECTORS = {
  chatCard: '[data-onboarding-chat-card]',
  chatScroller: '#onboardingScrollableDiv',
  continueButton: `xpath=//button[normalize-space()='Continue']`,
} as const;

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
// api.post returns response.data (see src/api/api.ts:230–236), so the mutation's
// onSuccess receives the body as `res`. useConversationSession reads
// res?.data?.access_token, which is body.data.access_token — the mock body must
// therefore wrap the tokens inside `data:`. Without this the history effect
// gates on empty tokens and never fires.
function buildStartOkResponse() {
  return { data: { access_token: 'tok-test-1', conversation_id: 'conv-test-1', success: true } };
}

// OnboardingChatPanel reads res?.data?.data → body.data.data is the items
// array. Wrap accordingly.
function buildHistoryResponse(items: Array<{ id?: string; answer: string | null }> = []) {
  return { data: { data: items } };
}

function finishedHistoryItem() {
  return { id: 'item-1', answer: JSON.stringify({ action: 'finished' }) };
}

function pendingHistoryItem() {
  return { id: 'item-1', answer: JSON.stringify({ action: 'in_progress' }) };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
async function mockStartApi(page: Page, onRequest?: (body: Record<string, unknown>) => void) {
  // Real endpoint: ${API_URL}/o/user/onboarding-progress/start (POST)
  await page.route('**/onboarding-progress/start**', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (onRequest) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      onRequest(body);
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildStartOkResponse()),
    });
  });
}

async function mockHistoryApi(
  page: Page,
  items: Array<{ id?: string; answer: string | null }> = []
) {
  // Real endpoint: ${API_URL}/o/user/onboarding-progress/history (POST).
  // OnboardingChatPanel reads response.data.data (axios body → { data: items }).
  await page.route('**/onboarding-progress/history**', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildHistoryResponse(items)),
    });
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const chatCard = (page: Page) => page.locator(SELECTORS.chatCard);

const continueBtn = (page: Page) =>
  page.locator(SELECTORS.continueButton);

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
async function setupPage(
  page: Page,
  historyItems: Array<{ id?: string; answer: string | null }> = []
) {
  await mockStartApi(page);
  await mockHistoryApi(page, historyItems);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Tour Text page', () => {
  // NOTE: tour/text.tsx has no SSR auth gate. The previous unauthenticated
  // redirect test was removed because the page does not implement it.

  test.describe('API calls on load', () => {
    test('fires POST /start with { mode: "text" } on mount', async ({ page }) => {
      await mockHistoryApi(page);
      await mockStartApi(page);

      const [startRequest] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'POST' && req.url().includes('onboarding-progress/start')
        ),
        page.goto(TEXT_URL),
      ]);

      const body = startRequest.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ mode: 'text' });
    });

    test('fires POST /history after start resolves', async ({ page }) => {
      await mockStartApi(page);
      await mockHistoryApi(page);

      const [historyRequest] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'POST' && req.url().includes('onboarding-progress/history')
        ),
        page.goto(TEXT_URL),
      ]);
      expect(historyRequest).toBeTruthy();
    });
  });

  test.describe('Continue button — conditional visibility', () => {
    test('Continue is hidden when history has no finished action', async ({ page }) => {
      await setupPage(page, [pendingHistoryItem()]);
      await page.goto(TEXT_URL);

      // Wait for page to settle — chat card must be present before asserting Continue is absent
      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });

    test('Continue is hidden when history is empty', async ({ page }) => {
      await setupPage(page, []);
      await page.goto(TEXT_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });

    test('Continue is visible when history[0].answer has action=finished', async ({ page }) => {
      await setupPage(page, [finishedHistoryItem()]);
      await page.goto(TEXT_URL);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Continue button — routing', () => {
    test('routes to /onboarding/tour/ai by default', async ({ page }) => {
      await setupPage(page, [finishedHistoryItem()]);
      await page.goto(TEXT_URL);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/ai/, { timeout: 10000 });
    });

    test('routes to /onboarding/summary when ?redirect=summary', async ({ page }) => {
      await setupPage(page, [finishedHistoryItem()]);
      await page.goto(`${TEXT_URL}?redirect=summary`);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('non-JSON answer does not crash the page and Continue stays hidden', async ({ page }) => {
      await setupPage(page, [{ id: 'item-1', answer: 'this is not json }{' }]);
      await page.goto(TEXT_URL);

      // Page must remain functional — chat card should still render
      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });

    test('null answer does not crash the page and Continue stays hidden', async ({ page }) => {
      await setupPage(page, [{ id: 'item-1', answer: null }]);
      await page.goto(TEXT_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });
  });
});
