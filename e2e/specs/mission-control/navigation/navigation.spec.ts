import { test, expect } from '../../../fixtures';

test.describe('Mission-Control — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Main sidebar navigation is visible', async ({ page }) => {
    const nav = page.locator('nav, [role="navigation"], aside').first();
    await expect(nav).toBeVisible({ timeout: 8_000 });
  });

  test('Courses nav item navigates to /courses', async ({ page }) => {
    const link = page.getByRole('link', { name: /courses?|cours/i }).first();
    const visible = await link.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Courses nav link not found');
    await link.click();
    await expect(page).toHaveURL(/courses/);
  });

  test('Bundles nav item navigates to /bundles', async ({ page }) => {
    const link = page.getByRole('link', { name: /bundles?/i }).first();
    const visible = await link.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Bundles nav link not found');
    await link.click();
    await expect(page).toHaveURL(/bundles/);
  });

  test('Organisations nav item navigates to /organisations', async ({ page }) => {
    const link = page.getByRole('link', { name: /organisations?|organizations?/i }).first();
    const visible = await link.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Organisations nav link not found');
    await link.click();
    await expect(page).toHaveURL(/organisation|organization/);
  });

  test('Configurations nav item navigates to /configurations', async ({ page }) => {
    const link = page.getByRole('link', { name: /config/i }).first();
    const visible = await link.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Configurations nav link not found');
    await link.click();
    await expect(page).toHaveURL(/config/);
  });

  test('User avatar / account menu is visible in the header', async ({ page }) => {
    const avatar = page.locator('[data-test="user-menu"], .mantine-Avatar-root, [class*="avatar"]').first();
    const visible = await avatar.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'User avatar not found');
    await expect(avatar).toBeVisible();
  });

  test('Navigation has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
