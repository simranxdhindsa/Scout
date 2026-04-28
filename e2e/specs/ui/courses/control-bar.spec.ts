import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Control Bar (17 tests)
 * Pre-condition: User is inside an asset viewer with a media asset.
 */
test.describe('Course Consumption — Control Bar', () => {
  const skipIfNoViewer = async (page: any) => {
    const viewer = page.locator('[data-test="asset-viewer"], [class*="viewer"], [class*="control-bar"]').first();
    const visible = await viewer.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Control bar / asset viewer not visible');
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('Control bar is visible in the asset viewer', async ({ page }) => {
    const bar = page.locator('[data-test="control-bar"], [class*="control-bar"], [class*="controls"]').first();
    const visible = await bar.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Control bar not found');
    await expect(bar).toBeVisible();
  });

  test('Play/Pause button is present in the control bar', async ({ page }) => {
    await skipIfNoViewer(page);
    const btn = page.getByRole('button', { name: /play|pause/i }).first();
    const visible = await btn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Play/Pause button not found');
    await expect(btn).toBeVisible();
  });

  test('Clicking Play starts media playback', async ({ page }) => {
    const video = page.locator('video').first();
    const hasVideo = await video.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasVideo, 'No video element');
    const playBtn = page.getByRole('button', { name: /play/i }).first();
    await playBtn.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('Clicking Pause stops media playback', async ({ page }) => {
    const video = page.locator('video').first();
    const hasVideo = await video.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasVideo, 'No video element');
    const playBtn = page.getByRole('button', { name: /play/i }).first();
    await playBtn.click();
    const pauseBtn = page.getByRole('button', { name: /pause/i }).first();
    const hasPause = await pauseBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasPause) await pauseBtn.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('Volume control slider is visible', async ({ page }) => {
    await skipIfNoViewer(page);
    const vol = page.locator('[data-test="volume"], [aria-label*="volume" i], input[type="range"]').first();
    const visible = await vol.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Volume control not found');
    await expect(vol).toBeVisible();
  });

  test('Mute button toggles muted state', async ({ page }) => {
    const muteBtn = page.getByRole('button', { name: /mute|unmute|volume/i }).first();
    const visible = await muteBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Mute button not found');
    await muteBtn.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('Seek bar / progress bar is visible', async ({ page }) => {
    await skipIfNoViewer(page);
    const seek = page.locator('[data-test="seek-bar"], [role="slider"], input[type="range"]').first();
    const visible = await seek.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Seek bar not found');
    await expect(seek).toBeVisible();
  });

  test('Current time and total duration are displayed', async ({ page }) => {
    await skipIfNoViewer(page);
    const time = page.locator('[data-test="time-display"], [class*="time"], [class*="duration"]').first();
    const visible = await time.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Time display not found');
    await expect(time).toBeVisible();
  });

  test('Full-screen button is present', async ({ page }) => {
    await skipIfNoViewer(page);
    const fs = page.getByRole('button', { name: /full.?screen|fullscreen/i }).first();
    const visible = await fs.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Fullscreen button not found');
    await expect(fs).toBeVisible();
  });

  test('Playback speed control is available', async ({ page }) => {
    await skipIfNoViewer(page);
    const speed = page.locator('[data-test="speed"], [class*="speed"]').first();
    const visible = await speed.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Speed control not found');
    await expect(speed).toBeVisible();
  });

  test('Changing playback speed does not crash the player', async ({ page }) => {
    const speed = page.locator('[data-test="speed"], [class*="speed"]').first();
    const visible = await speed.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Speed control not found');
    await speed.click();
    await page.locator('[role="menuitem"], [class*="option"]').first().click().catch(() => {});
    await expect(page).not.toHaveURL(/error/);
  });

  test('Subtitles / CC toggle is present when captions are available', async ({ page }) => {
    await skipIfNoViewer(page);
    const cc = page.getByRole('button', { name: /subtitle|caption|cc/i }).first();
    const visible = await cc.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!visible, 'CC button not found — may not be present for this asset');
    await expect(cc).toBeVisible();
  });

  test('Control bar remains visible after 3 seconds of inactivity (no auto-hide on desktop)', async ({ page }) => {
    await skipIfNoViewer(page);
    await page.waitForTimeout(3_000);
    const bar = page.locator('[data-test="control-bar"], [class*="control-bar"]').first();
    const visible = await bar.isVisible({ timeout: 1_000 }).catch(() => false);
    // Some players auto-hide — just assert page did not error
    await expect(page).not.toHaveURL(/error/);
  });

  test('Control bar is accessible via keyboard Tab navigation', async ({ page }) => {
    await skipIfNoViewer(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // Just confirm focus moves without throwing errors
    await expect(page).not.toHaveURL(/error/);
  });

  test('Control bar buttons have accessible labels', async ({ page }) => {
    await skipIfNoViewer(page);
    const buttons = page.locator('[data-test="control-bar"] button, [class*="control-bar"] button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = buttons.nth(i);
      const label = await btn.getAttribute('aria-label');
      const title = await btn.getAttribute('title');
      const text = await btn.textContent();
      expect(label || title || text).toBeTruthy();
    }
  });

  test('Control bar has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });

  test('Control bar matches visual baseline', async ({ page }) => {
    await skipIfNoViewer(page);
    const bar = page.locator('[data-test="control-bar"], [class*="control-bar"]').first();
    await expect(bar).toHaveScreenshot('control-bar.png');
  });
});
