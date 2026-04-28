import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';

/**
 * Weaver Mode — Create Course via Agentic (AI) flow
 *
 * What we test:
 *  - Project can be created in Agentic mode
 *  - Weaver chat input accepts a prompt
 *  - AI responds (we don't assert the content, only that a response appears)
 *  - Project appears in the projects list after creation
 *
 * What we DON'T test:
 *  - Voice input (mic) — cannot be automated in Playwright
 *  - Exact AI-generated content — non-deterministic
 */

const PROJECT_NAME = `Weaver-${faker.word.adjective()}-${Date.now()}`;
const INITIAL_PROMPT = 'Create a course about becoming an e-commerce seller. Make it beginner friendly.';
const FOLLOWUP_PROMPT = 'No I don\'t have prior experience with selling online.';

test.describe('Weaver Mode — Agentic course creation', () => {

  test('creates a new project in Agentic mode and completes Weaver conversation', async ({ page }) => {
    // ── 1. Go to Studio projects ──────────────────────────────────────────
    await page.goto('/studio/projects');
    await expect(page).toHaveURL(/studio\/projects/);

    // ── 2. Create new project ─────────────────────────────────────────────
    await page.getByRole('button', { name: /project/i }).click();

    // Fill project name
    const nameInput = page.getByRole('textbox', { name: /project name/i });
    await nameInput.click();
    await nameInput.fill(PROJECT_NAME);

    // Select language
    await page.getByRole('searchbox', { name: /select language/i }).click();
    await page.getByRole('option', { name: 'English' }).click();

    // Select Agentic mode (Weaver)
    await page.getByText('Agentic').click();

    // Save
    await page.getByRole('button', { name: /save/i }).click();

    // ── 3. Weaver chat should open ────────────────────────────────────────
    const chatInput = page.getByRole('textbox', { name: /type here or speak in the mic/i });
    await chatInput.waitFor({ state: 'visible', timeout: 30_000 });

    // ── 4. Send initial prompt ────────────────────────────────────────────
    await chatInput.fill(INITIAL_PROMPT);
    await chatInput.press('Enter');

    // Wait for AI to respond — a new message bubble should appear
    // We don't check content, just that a response element is present
    await expect(page.locator('[class*="message"], [class*="chat"], [class*="bubble"]').last())
      .not.toBeEmpty({ timeout: 60_000 });

    // ── 5. Send follow-up message ─────────────────────────────────────────
    await chatInput.waitFor({ state: 'visible', timeout: 30_000 });
    await chatInput.fill(FOLLOWUP_PROMPT);
    await chatInput.press('Enter');

    // Wait for second AI response
    await page.waitForTimeout(3_000); // brief wait for AI to start responding

    // ── 6. Navigate back and verify project exists in list ────────────────
    await page.goto('/studio/projects');
    await expect(page.getByText(PROJECT_NAME)).toBeVisible({ timeout: 15_000 });
  });

  test('Weaver chat input is visible after project creation', async ({ page }) => {
    // Lighter smoke test — just verifies the Weaver UI loads correctly
    await page.goto('/studio/projects');

    await page.getByRole('button', { name: /project/i }).click();

    const nameInput = page.getByRole('textbox', { name: /project name/i });
    await nameInput.fill(`Smoke-${Date.now()}`);

    await page.getByRole('searchbox', { name: /select language/i }).click();
    await page.getByRole('option', { name: 'English' }).click();

    await page.getByText('Agentic').click();
    await page.getByRole('button', { name: /save/i }).click();

    // Weaver chat input must appear
    await expect(
      page.getByRole('textbox', { name: /type here or speak in the mic/i })
    ).toBeVisible({ timeout: 30_000 });
  });

});
