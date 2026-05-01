import { test, expect } from '@playwright/test';

test('basic test - playwright homepage', async ({ page }) => {
  await page.goto('https://playwright.dev/');

  // Check title
  await expect(page).toHaveTitle(/Playwright/);

  // Check heading
  await expect(page.getByRole('heading', { name: /Playwright enables reliable/i }))
    .toBeVisible();

  // Click "Get started"
  await page.getByRole('link', { name: /get started/i }).click();

  // Verify navigation worked
  await expect(page).toHaveURL(/.*intro/);
});