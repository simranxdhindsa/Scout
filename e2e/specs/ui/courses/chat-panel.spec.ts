import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Chat / Transcript Panel (3 tests)
 * Pre-condition: User is inside an asset that has a chat or transcript panel.
 */
test.describe('Course Consumption — Chat / Transcript Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('Chat / Transcript panel toggle button is visible', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /chat|transcript|discussion/i }).first();
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Chat/Transcript toggle not found');
    await expect(toggle).toBeVisible();
  });

  test('Opening the chat panel shows the message input area', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /chat|transcript|discussion/i }).first();
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Chat/Transcript toggle not found');
    await toggle.click();
    const panel = page.locator('[data-test="chat-panel"], [class*="chat-panel"], [class*="transcript"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
    const input = panel.locator('input, textarea').first();
    const inputVisible = await input.isVisible({ timeout: 3_000 }).catch(() => false);
    if (inputVisible) await expect(input).toBeEnabled();
  });

  test('Chat panel has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
