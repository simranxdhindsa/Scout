import { test, expect } from '../../../fixtures';

test.describe('Security — Transport — HTTPS', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Access app via HTTP — verify redirect to HTTPS', async ({ page }) => {
    const uiUrl = process.env.PLAYWRIGHT_UI_URL || '';
    test.skip(!uiUrl.startsWith('https'), 'App URL is not HTTPS — skipping redirect test');
    const httpUrl = uiUrl.replace('https://', 'http://');
    await page.goto(httpUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
    // Should redirect to HTTPS
    await expect(page).toHaveURL(/^https:/);
  });
});

test.describe('Security — Transport — Mixed Content', () => {
  test('Verify all media load via HTTPS — no mixed content warnings', async ({ page }) => {
    const consoleWarnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().toLowerCase().includes('mixed content')) {
        consoleWarnings.push(msg.text());
      }
    });

    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    expect(consoleWarnings).toHaveLength(0);

    // Check page for any HTTP (non-HTTPS) image/video/audio sources
    const httpMedia = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('img, video, audio, source')];
      return elements
        .map((el) => el.getAttribute('src') || '')
        .filter((src) => src.startsWith('http://'));
    });
    expect(httpMedia).toHaveLength(0);
  });
});
