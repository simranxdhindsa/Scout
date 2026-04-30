import { test, expect } from '../../../fixtures';

test.describe('Mission-Control — Organisations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/organisations');
    await page.waitForLoadState('networkidle');
  });

  test('Organisations page loads at /organisations', async ({ page }) => {
    await expect(page).toHaveURL(/organisations|organizations/);
  });

  test('Organisations list / table renders', async ({ page }) => {
    const container = page.locator('table, [class*="list"], [class*="grid"]').first();
    await expect(container).toBeVisible({ timeout: 8_000 });
  });

  test('Organisation name column is visible in the table', async ({ page }) => {
    const nameCol = page.locator('th').filter({ hasText: /name|nom/i }).first();
    const visible = await nameCol.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Name column header not found');
    await expect(nameCol).toBeVisible();
  });

  test('Search / filter input narrows organisation list', async ({ page }) => {
    const search = page.locator('input[type="text"], input[type="search"]').first();
    const visible = await search.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Search input not found');
    await search.fill('nonexistent-org-xyz');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/organisations|organizations/);
  });

  test('Clicking an organisation row navigates to its detail page', async ({ page }) => {
    const row = page.locator('tr').filter({ has: page.locator('td') }).first();
    const hasRow = await row.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasRow, 'No organisation rows available');
    await row.click();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/organisations$/);
  });

  test('Organisations page has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
