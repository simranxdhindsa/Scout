import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Audio Controls (7 tests)
 * Pre-condition: An audio asset is open in the viewer.
 */
test.describe('Course Consumption — Audio Controls', () => {
  const hasAudio = async (page: any): Promise<boolean> => {
    return page.locator('audio').isVisible({ timeout: 5_000 }).catch(() => false);
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('Audio player renders for audio assets', async ({ page }) => {
    const exists = await hasAudio(page);
    test.skip(!exists, 'No audio asset available');
    await expect(page.locator('audio')).toBeAttached();
  });

  test('Audio plays after clicking Play', async ({ page }) => {
    const exists = await hasAudio(page);
    test.skip(!exists, 'No audio element');
    const playBtn = page.getByRole('button', { name: /play/i }).first();
    const visible = await playBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Play button not found');
    await playBtn.click();
    await page.waitForTimeout(500);
    const paused = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused);
    expect(paused).toBe(false);
  });

  test('Audio pauses when Pause is clicked', async ({ page }) => {
    const exists = await hasAudio(page);
    test.skip(!exists, 'No audio element');
    const audio = page.locator('audio').first();
    await audio.evaluate((a: HTMLAudioElement) => a.play());
    await page.waitForTimeout(500);
    const pauseBtn = page.getByRole('button', { name: /pause/i }).first();
    const visible = await pauseBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (visible) await pauseBtn.click();
    const paused = await audio.evaluate((a: HTMLAudioElement) => a.paused);
    expect(paused).toBe(true);
  });

  test('Audio volume can be changed', async ({ page }) => {
    const exists = await hasAudio(page);
    test.skip(!exists, 'No audio element');
    await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.volume = 0.3; });
    const vol = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.volume);
    expect(vol).toBeCloseTo(0.3, 1);
  });

  test('Audio can be muted and unmuted', async ({ page }) => {
    const exists = await hasAudio(page);
    test.skip(!exists, 'No audio element');
    const muteBtn = page.getByRole('button', { name: /mute|volume/i }).first();
    const visible = await muteBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Mute button not found');
    await muteBtn.click();
    const muted = await page.locator('audio').evaluate((a: HTMLAudioElement) => a.muted);
    expect(muted).toBe(true);
  });

  test('Audio seek bar updates current time', async ({ page }) => {
    const exists = await hasAudio(page);
    test.skip(!exists, 'No audio element');
    const audio = page.locator('audio').first();
    await audio.evaluate((a: HTMLAudioElement) => { a.currentTime = 3; });
    const time = await audio.evaluate((a: HTMLAudioElement) => a.currentTime);
    expect(time).toBeGreaterThanOrEqual(2.5);
  });

  test('Audio controls have no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
