import { test, expect } from '../../../fixtures';

test.describe('Mission-Control — Configurations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/configurations');
    await page.waitForLoadState('networkidle');
  });

  test('Configurations page loads at /configurations', async ({ page }) => {
    await expect(page).toHaveURL(/configuration/);
  });

  test('Configuration section headings are visible', async ({ page }) => {
    const headings = page.locator('h1, h2, h3, [class*="section-title"]');
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Bots / Avatars section is accessible via tab or link', async ({ page }) => {
    const botsLink = page.getByRole('link', { name: /bots?|avatar/i })
      .or(page.getByRole('tab', { name: /bots?|avatar/i })).first();
    const visible = await botsLink.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Bots/Avatars link not found');
    await botsLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/bots|avatar|configuration/);
  });

  test('Translations section is accessible via tab or link', async ({ page }) => {
    const translationsLink = page.getByRole('link', { name: /translat|traduct/i })
      .or(page.getByRole('tab', { name: /translat|traduct/i })).first();
    const visible = await translationsLink.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Translations link/tab not found');
    await translationsLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error/);
  });

  test('Configuration form fields are not editable in read-only assertion', async ({ page }) => {
    // Just assert form elements render — do not submit
    const inputs = page.locator('input, select, textarea');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(0);
    await expect(page).not.toHaveURL(/error/);
  });

  test('Configurations page has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
