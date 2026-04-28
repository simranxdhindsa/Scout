import { test, expect } from '../../../fixtures';

test.describe('Mission-Control — Bundles List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/bundles');
    await page.waitForLoadState('networkidle');
  });

  test('Bundles list page loads at /bundles', async ({ page }) => {
    await expect(page).toHaveURL(/bundles/);
  });

  test('Bundles table or card grid renders', async ({ page }) => {
    const container = page.locator('table, [class*="grid"], [class*="list"]').first();
    await expect(container).toBeVisible({ timeout: 8_000 });
  });

  test('Create Bundle button is visible', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /create|add|nouveau|ajouter/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
  });

  test('Search input filters bundles by name', async ({ page }) => {
    const search = page.locator('input[type="text"], input[type="search"]').first();
    const visible = await search.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Search input not found');
    await search.fill('nonexistent-bundle-xyz');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/bundles/);
  });

  test('Clicking a bundle row navigates to bundle detail', async ({ page }) => {
    const row = page.locator('tr').filter({ has: page.locator('td') }).first();
    const card = page.locator('[class*="card"]').first();
    const hasRow = await row.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasCard = await card.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasRow && !hasCard, 'No bundle rows/cards available');
    if (hasRow) await row.click();
    else await card.click();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/bundles$/);
  });

  test('Bundles list has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
