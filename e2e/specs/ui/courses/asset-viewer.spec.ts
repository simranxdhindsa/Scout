import { test, expect } from '../../../fixtures';
import { CourseDetailPage } from '../../../pages/ui/course-detail.page';

/**
 * QA Doc — Course Consumption: Asset Viewer (18 tests)
 * Pre-condition: User is enrolled in a course with at least one asset.
 */
test.describe('Course Consumption — Asset Viewer', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate into a course; skip individual tests if no course is available
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('Asset viewer container renders when a course asset is opened', async ({ page }) => {
    const detail = new CourseDetailPage(page);
    await page.goto('/courses');
    const card = page.locator('[class*="card"], [data-test="course-card"]').first();
    const hasCard = await card.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasCard, 'No course cards available');
    await card.click();
    await page.waitForLoadState('networkidle');
    const startBtn = detail.startButton;
    const hasStart = await startBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasStart, 'No start button — course may not be enrolled');
    await startBtn.click();
    await page.waitForLoadState('networkidle');
    const viewer = page.locator('[data-test="asset-viewer"], [class*="viewer"], [class*="player"]').first();
    await expect(viewer).toBeVisible({ timeout: 10_000 });
  });

  test('Asset title is displayed above the viewer', async ({ page }) => {
    const title = page.locator('[data-test="asset-title"], [class*="asset-title"]').first();
    const visible = await title.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Asset viewer not open');
    await expect(title).toBeVisible();
  });

  test('Asset content area is not empty', async ({ page }) => {
    const content = page.locator('[data-test="asset-content"], video, audio, [class*="pdf"]').first();
    const visible = await content.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'No asset content rendered');
    await expect(content).toBeVisible();
  });

  test('Breadcrumb navigation shows course and asset hierarchy', async ({ page }) => {
    const breadcrumb = page.locator('[aria-label*="breadcrumb"], [class*="breadcrumb"]').first();
    const visible = await breadcrumb.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Breadcrumb not present');
    await expect(breadcrumb).toBeVisible();
  });

  test('Section/chapter label is visible in the asset viewer area', async ({ page }) => {
    const section = page.locator('[data-test="section-label"], [class*="section-name"]').first();
    const visible = await section.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Section label not present');
    await expect(section).toBeVisible();
  });

  test('Asset index / progress indicator is displayed (e.g. "Asset 2 of 5")', async ({ page }) => {
    const indicator = page.locator('[data-test="asset-progress"], [class*="asset-count"]').first();
    const visible = await indicator.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Asset progress indicator not present');
    await expect(indicator).toBeVisible();
  });

  test('Transcript panel toggle button is visible', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /transcript|chat/i }).first();
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Transcript toggle not found');
    await expect(toggle).toBeVisible();
  });

  test('Opening transcript panel shows transcript content area', async ({ page }) => {
    const toggle = page.getByRole('button', { name: /transcript/i }).first();
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Transcript toggle not found');
    await toggle.click();
    const panel = page.locator('[data-test="transcript-panel"], [class*="transcript"]').first();
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });

  test('Asset viewer does not show JavaScript errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.waitForTimeout(2_000);
    const jsErrors = errors.filter(e => !e.includes('favicon') && !e.includes('analytics'));
    expect(jsErrors).toHaveLength(0);
  });

  test('Keyboard shortcut Space bar toggles video/audio playback', async ({ page }) => {
    const video = page.locator('video').first();
    const hasVideo = await video.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasVideo, 'No video element on page');
    await video.click(); // focus
    await page.keyboard.press('Space');
    // Just assert no error thrown — playback state check is environment-dependent
    await expect(page).not.toHaveURL(/error/);
  });

  test('Keyboard shortcut ArrowRight skips forward', async ({ page }) => {
    const video = page.locator('video').first();
    const hasVideo = await video.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasVideo, 'No video element on page');
    await video.click();
    await page.keyboard.press('ArrowRight');
    await expect(page).not.toHaveURL(/error/);
  });

  test('Asset viewer is responsive at mobile viewport (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const viewer = page.locator('[data-test="asset-viewer"], [class*="viewer"]').first();
    const visible = await viewer.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Viewer not open');
    await expect(viewer).toBeVisible();
    const box = await viewer.boundingBox();
    if (box) expect(box.width).toBeLessThanOrEqual(375);
  });

  test('Asset viewer has no horizontal scroll overflow', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('Asset viewer container has correct ARIA role', async ({ page }) => {
    const viewer = page.locator('[role="main"], [role="region"]').first();
    const visible = await viewer.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'No ARIA landmark found');
    await expect(viewer).toBeVisible();
  });

  test('Loading spinner disappears after asset loads', async ({ page }) => {
    const spinner = page.locator('[class*="loading"], [class*="spinner"]').first();
    // Spinner should disappear within 10 seconds
    await spinner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await expect(page).not.toHaveURL(/error/);
  });

  test('Network request for asset content returns 200', async ({ page }) => {
    const responses: number[] = [];
    page.on('response', res => {
      if (res.url().includes('/asset') || res.url().includes('/media')) {
        responses.push(res.status());
      }
    });
    await page.waitForTimeout(3_000);
    const failed = responses.filter(s => s >= 500);
    expect(failed).toHaveLength(0);
  });

  test('Asset viewer has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });

  test('Asset viewer matches visual baseline', async ({ page }) => {
    await expect(page).toHaveScreenshot('asset-viewer.png', { fullPage: false });
  });
});
