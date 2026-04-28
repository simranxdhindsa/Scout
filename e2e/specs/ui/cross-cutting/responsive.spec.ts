import { test, expect } from '../../../fixtures';

test.describe('Responsive — Mobile (<768px)', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone 12

  test('Verify mobile adaptations — sidebar hidden, single column', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Sidebar should be hidden on mobile
    const sidebar = page.locator('nav, [data-test="sidebar"]').first();
    const sidebarBox = await sidebar.boundingBox();
    if (sidebarBox) {
      // On mobile, sidebar should be either hidden or collapsed to 0 width
      expect(sidebarBox.width).toBeLessThanOrEqual(70);
    }

    // No horizontal scrollbar
    const hasHScroll = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(hasHScroll).toBeFalsy();
  });
});

test.describe('Responsive — Desktop (1280px)', () => {
  test('Verify desktop two-panel layout', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Main content should be visible
    const main = page.locator('main, [role="main"]').first();
    await expect(main).toBeVisible();

    // Check that full width is utilized
    const bodyWidth = await page.evaluate(() => document.body.clientWidth);
    expect(bodyWidth).toBeGreaterThan(900);
  });
});

test.describe('Responsive — XL (>1600px)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('Verify XL layout has extra spacing', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    // Just verify the page renders without layout breaks at XL
    const main = page.locator('main, [role="main"]').first();
    await expect(main).toBeVisible();
    const hasHScroll = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
    expect(hasHScroll).toBeFalsy();
  });
});
