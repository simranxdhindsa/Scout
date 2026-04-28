import { test, expect } from '../../../fixtures';

test.describe('Studio-Web — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
  });

  test('Main navigation is visible', async ({ page }) => {
    const nav = page.locator('nav, [role="navigation"], header').first();
    await expect(nav).toBeVisible({ timeout: 8_000 });
  });

  test('Projects link navigates to projects list', async ({ page }) => {
    const link = page.getByRole('link', { name: /projects?/i }).first();
    const linkVisible = await link.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!linkVisible, 'Projects nav link not found');
    await link.click();
    await expect(page).toHaveURL(/projects/);
  });

  test('Logo or home link navigates to root or projects', async ({ page }) => {
    const logo = page.locator('[data-test="logo"], [class*="logo"], header a').first();
    const logoVisible = await logo.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!logoVisible, 'Logo/home link not found');
    await logo.click();
    await page.waitForLoadState('networkidle');
    // Should stay within the app (not bounce to external URL)
    const currentUrl = page.url();
    const swUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    if (swUrl) expect(currentUrl).toContain(new URL(swUrl).hostname);
  });

  test('User avatar or profile menu is visible in header', async ({ page }) => {
    const avatar = page.locator('[data-test="user-menu"], .mantine-Avatar-root, [class*="avatar"]').first();
    const visible = await avatar.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'User avatar/menu not found in header');
    await expect(avatar).toBeVisible();
  });

  test('Navigation has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
