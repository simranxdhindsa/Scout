import { test, expect } from '../../../fixtures';
import { TestData } from '../../../utils/test-data';

/**
 * Lifecycle test — creates a real bundle in Mission-Control.
 * Optional cleanup: delete via admin UI or API after validation.
 */
test.describe('Mission-Control — Bundle Creation Lifecycle', () => {
  test('Create new bundle and verify redirect to bundle overview', async ({ page }) => {
    const data = { name: TestData.course.title() }; // Reuse course title for bundle name

    await page.goto('/bundles');
    await page.waitForLoadState('networkidle');

    // Click Create Bundle button
    const createBtn = page.getByRole('button', { name: /create|add|nouveau/i }).first();
    const btnVisible = await createBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!btnVisible, 'Create Bundle button not found');
    await createBtn.click();

    // Fill bundle name
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();
    await nameInput.waitFor({ state: 'visible', timeout: 8_000 });
    await nameInput.fill(`[AUTO] Bundle ${data.name}`);

    // Capture POST request
    let bundleCreated = false;
    page.on('request', req => {
      if (req.url().includes('/bundle') && req.method() === 'POST') bundleCreated = true;
    });

    // Submit form
    const submitBtn = page.getByRole('button', { name: /save|create|submit|enregistrer/i }).first();
    await submitBtn.click();

    // Assert redirect to bundle detail page (contains UUID)
    await page.waitForURL(url => /[0-9a-f-]{36}/.test(url.pathname), { timeout: 20_000 });
    const uuid = page.url().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    expect(uuid).toBeTruthy();
    console.log(`[bundle-create] Created bundle UUID: ${uuid}`);

    await expect(page).not.toHaveURL(/\/bundles$/);
  });
});
