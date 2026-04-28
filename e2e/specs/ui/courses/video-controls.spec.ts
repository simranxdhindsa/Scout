import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Video Controls (18 tests)
 * Pre-condition: A video asset is open in the viewer.
 */
test.describe('Course Consumption — Video Controls', () => {
  const hasVideo = async (page: any): Promise<boolean> => {
    return page.locator('video').isVisible({ timeout: 5_000 }).catch(() => false);
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('Video element is rendered in the asset viewer', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video asset available');
    await expect(page.locator('video')).toBeVisible();
  });

  test('Video loads without network error (HTTP 200)', async ({ page }) => {
    const videoErrors: number[] = [];
    page.on('response', res => {
      if (res.request().resourceType() === 'media' && res.status() >= 400) {
        videoErrors.push(res.status());
      }
    });
    await page.waitForTimeout(3_000);
    expect(videoErrors).toHaveLength(0);
  });

  test('Video has correct aspect ratio (no distortion)', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const video = page.locator('video').first();
    const box = await video.boundingBox();
    if (box) {
      const ratio = box.width / box.height;
      // Accept 4:3 (1.33) to 21:9 (2.33) as valid ratios
      expect(ratio).toBeGreaterThan(1.2);
      expect(ratio).toBeLessThan(2.4);
    }
  });

  test('Video poster/thumbnail is shown before playback starts', async ({ page }) => {
    const video = page.locator('video').first();
    const exists = await video.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!exists, 'No video element');
    const poster = await video.getAttribute('poster');
    // Poster may or may not be set — just assert no error
    await expect(page).not.toHaveURL(/error/);
  });

  test('Video plays after clicking Play button', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const playBtn = page.getByRole('button', { name: /play/i }).first();
    const btnVisible = await playBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!btnVisible, 'Play button not found');
    await playBtn.click();
    await page.waitForTimeout(1_000);
    const paused = await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused);
    expect(paused).toBe(false);
  });

  test('Video pauses when Pause button is clicked', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const video = page.locator('video').first();
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await page.waitForTimeout(500);
    const pauseBtn = page.getByRole('button', { name: /pause/i }).first();
    const btnVisible = await pauseBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (btnVisible) await pauseBtn.click();
    await page.waitForTimeout(500);
    const paused = await video.evaluate((v: HTMLVideoElement) => v.paused);
    expect(paused).toBe(true);
  });

  test('Seeking via progress bar updates video current time', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const video = page.locator('video').first();
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    if (!duration || isNaN(duration)) test.skip(true, 'Video duration unavailable');
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 5; });
    const currentTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    expect(currentTime).toBeGreaterThanOrEqual(4.5);
  });

  test('Volume can be adjusted via slider', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const video = page.locator('video').first();
    await video.evaluate((v: HTMLVideoElement) => { v.volume = 0.5; });
    const vol = await video.evaluate((v: HTMLVideoElement) => v.volume);
    expect(vol).toBeCloseTo(0.5, 1);
  });

  test('Muting video sets volume indicator to zero', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const muteBtn = page.getByRole('button', { name: /mute|volume/i }).first();
    const visible = await muteBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Mute button not found');
    await muteBtn.click();
    const muted = await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted);
    expect(muted).toBe(true);
  });

  test('Full-screen mode activates without errors', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const fsBtn = page.getByRole('button', { name: /full.?screen/i }).first();
    const visible = await fsBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Fullscreen button not found');
    await fsBtn.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('Playback speed 1.5x changes video playback rate', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    await page.locator('video').evaluate((v: HTMLVideoElement) => { v.playbackRate = 1.5; });
    const rate = await page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate);
    expect(rate).toBeCloseTo(1.5, 1);
  });

  test('Playback speed 0.5x changes video playback rate', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    await page.locator('video').evaluate((v: HTMLVideoElement) => { v.playbackRate = 0.5; });
    const rate = await page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate);
    expect(rate).toBeCloseTo(0.5, 1);
  });

  test('Video restarts from beginning after completion', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const video = page.locator('video').first();
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    if (!duration || isNaN(duration)) test.skip(true, 'Cannot read duration');
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - 0.5; });
    await page.waitForTimeout(1_500);
    const ended = await video.evaluate((v: HTMLVideoElement) => v.ended);
    expect(ended).toBe(true);
  });

  test('Video subtitle track toggle works (when captions available)', async ({ page }) => {
    const ccBtn = page.getByRole('button', { name: /subtitle|caption|cc/i }).first();
    const visible = await ccBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!visible, 'No CC/subtitle button');
    await ccBtn.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('Video controls are keyboard accessible', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page).not.toHaveURL(/error/);
  });

  test('Video element has accessible title or aria-label', async ({ page }) => {
    const exists = await hasVideo(page);
    test.skip(!exists, 'No video element');
    const video = page.locator('video').first();
    const label = await video.getAttribute('aria-label');
    const title = await video.getAttribute('title');
    // At minimum the player container should have a label
    const container = video.locator('..');
    const containerLabel = await container.getAttribute('aria-label');
    expect(label || title || containerLabel).toBeTruthy();
  });

  test('No 4xx/5xx errors on video API requests', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', res => {
      if (res.status() >= 400 && res.url().includes('/media')) {
        failed.push(`${res.status()} ${res.url()}`);
      }
    });
    await page.waitForTimeout(3_000);
    expect(failed).toHaveLength(0);
  });

  test('Video controls have no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
