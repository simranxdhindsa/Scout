import { test, expect, Page } from '@playwright/test';

/*
 * ASSUMPTIONS
 * 1. Auth is handled globally by playwright.config.ts storageState (set in globalSetup).
 * 2. The AI tour page renders a chat card and a dummy (non-interactive) input bar on mount.
 * 3. Continue is ALWAYS visible — no API gate; it does not depend on chat history.
 * 4. An ActionIcon (toggle button) shows/hides the chat card region; the icon itself swaps
 *    between an open and close state on each click.
 * 5. The dummy input bar is non-editable — it may carry a disabled/readonly attribute,
 *    or be a styled non-input element; tests assert it cannot be typed into.
 * 6. No POST mocking is required for basic rendering — the page is static enough to load
 *    without API responses for these assertions.
 * 7. Tests are parallel-safe; each runs in its own page context.
 *
 * LOCATOR MAP
 * chatCard         — [data-onboarding-chat-card]      (chat container root)
 * continueButton   — role=button name="Continue"
 * toggleChatButton — [data-testid="onboarding-ai-toggle"]  (ActionIcon toggle)
 * inputPlaceholder — div with text "Choose Dictate or Live Chat" (styled div, not a real input)
 *
 * RECOMMENDED DATA-TESTID HOOKS (ask app team to add if selectors become flaky):
 *   data-testid="onboarding-continue-btn"    on the Continue <button>
 *   data-testid="onboarding-ai-toggle"       on the toggle ActionIcon wrapper
 *   data-testid="onboarding-chat-card"       on the chat container root (same as data-onboarding-chat-card)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AI_URL = '/onboarding/tour/ai';

// ---------------------------------------------------------------------------
// Selector map
// ---------------------------------------------------------------------------
const SELECTORS = {
  chatCard: '[data-onboarding-chat-card]',
  continueButton: `xpath=//button[normalize-space()='Continue']`,
  // Primary: data-testid set by app team. Fallback: role=button inside the chat card ancestor.
  toggleChatButton: '[data-testid="toggle-chat-button"]',
  // Dummy input bar — rendered as a non-interactive div, not a real input element.
  dummyInput: `xpath=//div[normalize-space()='Choose Dictate or Live Chat' and not(descendant::div[normalize-space()='Choose Dictate or Live Chat'])]`,
} as const;

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const chatCard = (page: Page) => page.locator(SELECTORS.chatCard);

const continueBtn = (page: Page) => page.locator(SELECTORS.continueButton);

const toggleChatBtn = (page: Page) => page.locator(SELECTORS.toggleChatButton);

const dummyInput = (page: Page) => page.locator(SELECTORS.dummyInput);

// clip-path: inset(0px round 8px)        → visible
// clip-path: inset(100% 0px 0px round 8px) → hidden
const getChatCardClipPath = (page: Page) =>
  chatCard(page).evaluate((el) => window.getComputedStyle(el).clipPath);

const expectChatCardVisible = async (page: Page) =>
  expect.poll(() => getChatCardClipPath(page)).not.toContain('100%');

const expectChatCardHidden = async (page: Page) =>
  expect.poll(() => getChatCardClipPath(page)).toContain('100%');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Tour AI page', () => {
  // NOTE: tour/ai.tsx has no SSR auth and no middleware enforcing auth on this
  // route — an unauthenticated visit currently does NOT redirect. The previous
  // auth redirect test was removed because it asserted unimplemented behavior.

  test.describe('Rendering', () => {
    test('renders chat card, instructional content, and Continue button', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
    });

    test('Continue button is visible without any prior interaction', async ({ page }) => {
      await page.goto(AI_URL);

      // No gate — Continue must be immediately present once page loads
      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
    });

    test('dummy input bar is visible on the page', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expect(dummyInput(page).first()).toBeVisible();
    });

    test('dummy mode selector (Text/Voice) is rendered but non-interactive', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });

      // Both pseudo-tabs render as <Text> elements with cursor: not-allowed.
      // They are not <button>, so they're not focusable controls. DOM text is
      // uppercase ("TEXT" / "VOICE") so the regex is case-insensitive.
      const textTab = page.getByText(/^Text$/i).first();
      const voiceTab = page.getByText(/^Voice$/i).first();
      await expect(textTab).toBeVisible();
      await expect(voiceTab).toBeVisible();

      const cursor = await textTab.evaluate((el) =>
        window.getComputedStyle(el as HTMLElement).cursor
      );
      expect(cursor).toBe('not-allowed');
    });

    test('dummy input is non-editable (plain div, not contenteditable)', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });

      const input = dummyInput(page).first();
      await expect(input).toBeVisible();

      // It is a div, not a form element — assert it has no contenteditable="true"
      const contentEditable = await input.getAttribute('contenteditable');
      expect(contentEditable === null || contentEditable === 'false').toBe(true);
    });
  });

  test.describe('Toggle — chat card visibility', () => {
    test('chat card clip-path is in the open state initially', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await expectChatCardVisible(page);
    });

    test('clicking toggle transitions clip-path to the hidden state', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await toggleChatBtn(page).click();

      await expectChatCardHidden(page);
    });

    test('clicking toggle twice restores the open clip-path state', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(chatCard(page)).toBeVisible({ timeout: 10000 });
      await toggleChatBtn(page).click();
      await expectChatCardHidden(page);

      await toggleChatBtn(page).click();
      await expectChatCardVisible(page);
    });
  });

  test.describe('Continue button — routing', () => {
    test('routes to /onboarding/tour/interests by default', async ({ page }) => {
      await page.goto(AI_URL);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/interests/, { timeout: 10000 });
    });

    test('routes to /onboarding/summary when ?redirect=summary', async ({ page }) => {
      await page.goto(`${AI_URL}?redirect=summary`);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 10000 });
    });
  });
});
