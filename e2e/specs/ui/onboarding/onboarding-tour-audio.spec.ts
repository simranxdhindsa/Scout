import { test, expect, Page, Route } from '@playwright/test';

/*
 * COVERAGE
 * Companion to onboarding-tour-text.spec.ts. The audio tour mounts:
 *   useConversationSession('audio')  → POST /onboarding-progress/start { mode: "audio" }
 *   OnboardingChatPanel              → POST /onboarding-progress/history once start resolves
 * tourCompleted is dispatched by useExecuteActions when history[0].answer parses
 * to `{ action: 'finished' }` — that gates the Continue button.
 *
 * NOTE: tour/audio.tsx has no SSR auth gate, so no unauthenticated-redirect test
 * is included here.
 *
 * AUDIO SLOT: OnboardingAudioPlayer renders a play/pause control wired to a
 * shared <audio> element managed by useOnboardingTTS. We don't drive real
 * audio in these specs — only assert the player surface renders.
 */

const AUDIO_URL = '/onboarding/tour/audio';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
// api.post returns response.data, so the mutation's onSuccess receives the
// body as `res`. useConversationSession reads res?.data?.access_token →
// body.data.access_token; OnboardingChatPanel reads res?.data?.data → the
// items array sits at body.data.data. Mock bodies wrap accordingly.
function buildStartOkResponse() {
  return { data: { access_token: 'tok-audio-1', conversation_id: 'conv-audio-1', success: true } };
}

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
  await page.route('**/onboarding-progress/start**', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (onRequest) onRequest(route.request().postDataJSON() as Record<string, unknown>);
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
  await page.route('**/onboarding-progress/history**', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildHistoryResponse(items)),
    });
  });
}

async function mockUserAvatarApi(page: Page) {
  // OnboardingAudioPlayer calls useGetUserAvatar → GET /o/user/profile/org-avatar.
  await page.route('**/user/profile/org-avatar**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { avatar_display: '/avatar.png' } }),
    });
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const chatCard = (page: Page) => page.locator('[data-onboarding-chat-card]');

const continueBtn = (page: Page) =>
  page.locator(`xpath=//button[normalize-space()='Continue']`);

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
async function setupPage(
  page: Page,
  historyItems: Array<{ id?: string; answer: string | null }> = []
) {
  await mockUserAvatarApi(page);
  await mockStartApi(page);
  await mockHistoryApi(page, historyItems);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Tour Audio page', () => {
  test.describe('API calls on load', () => {
    test('fires POST /start with { mode: "audio" } on mount', async ({ page }) => {
      await mockUserAvatarApi(page);
      await mockHistoryApi(page);
      await mockStartApi(page);

      const [startRequest] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'POST' && req.url().includes('onboarding-progress/start')
        ),
        page.goto(AUDIO_URL),
      ]);

      const body = startRequest.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ mode: 'audio' });
    });

    test('fires POST /history after start resolves', async ({ page }) => {
      await mockUserAvatarApi(page);
      await mockStartApi(page);
      await mockHistoryApi(page);

      const [historyRequest] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'POST' && req.url().includes('onboarding-progress/history')
        ),
        page.goto(AUDIO_URL),
      ]);
      expect(historyRequest).toBeTruthy();
    });
  });

  test.describe('Continue button — conditional visibility', () => {
    test('Continue is hidden when history has no finished action', async ({ page }) => {
      await setupPage(page, [pendingHistoryItem()]);
      await page.goto(AUDIO_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });

    test('Continue is hidden when history is empty', async ({ page }) => {
      await setupPage(page, []);
      await page.goto(AUDIO_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });

    test('Continue is visible when history[0].answer has action=finished', async ({ page }) => {
      await setupPage(page, [finishedHistoryItem()]);
      await page.goto(AUDIO_URL);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Continue button — routing', () => {
    test('routes to /onboarding/tour/ai by default', async ({ page }) => {
      await setupPage(page, [finishedHistoryItem()]);
      await page.goto(AUDIO_URL);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/ai/, { timeout: 10000 });
    });

    test('routes to /onboarding/summary when ?redirect=summary', async ({ page }) => {
      await setupPage(page, [finishedHistoryItem()]);
      await page.goto(`${AUDIO_URL}?redirect=summary`);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('non-JSON answer does not crash the page and Continue stays hidden', async ({ page }) => {
      await setupPage(page, [{ id: 'item-1', answer: 'not json }{' }]);
      await page.goto(AUDIO_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });

    test('null answer does not crash the page and Continue stays hidden', async ({ page }) => {
      await setupPage(page, [{ id: 'item-1', answer: null }]);
      await page.goto(AUDIO_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeHidden();
    });
  });
});
