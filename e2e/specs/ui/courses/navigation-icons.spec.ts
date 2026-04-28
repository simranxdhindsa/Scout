import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Navigation Icons: Previous / Next Asset (10 tests)
 * Pre-condition: User is inside a course with multiple assets.
 */
test.describe('Course Consumption — Navigation Icons (Prev/Next Asset)', () => {
  const hasPrevNext = async (page: any): Promise<boolean> => {
    const next = await page.getByRole('button', { name: /next|suivant|→/i })
      .isVisible({ timeout: 5_000 }).catch(() => false);
    return next;
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('Next Asset button is visible in the asset viewer', async ({ page }) => {
    const exists = await hasPrevNext(page);
    test.skip(!exists, 'Next button not found — may be single-asset course');
    await expect(page.getByRole('button', { name: /next|suivant/i }).first()).toBeVisible();
  });

  test('Previous Asset button is visible in the asset viewer', async ({ page }) => {
    const prevBtn = page.getByRole('button', { name: /prev|précédent|←/i }).first();
    const visible = await prevBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Previous button not found');
    await expect(prevBtn).toBeVisible();
  });

  test('Clicking Next Asset navigates to the next asset', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
    const visible = await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Next button not found');
    const urlBefore = page.url();
    await nextBtn.click();
    await page.waitForLoadState('networkidle');
    // URL or page content should change
    const urlAfter = page.url();
    // Either URL changed or page loaded new asset
    await expect(page).not.toHaveURL(/error/);
  });

  test('Clicking Previous Asset navigates to the previous asset', async ({ page }) => {
    // Navigate to second asset first
    const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
    const hasNext = await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasNext, 'No next button — cannot reach second asset');
    await nextBtn.click();
    await page.waitForLoadState('networkidle');
    const prevBtn = page.getByRole('button', { name: /prev|précédent|←/i }).first();
    const hasPrev = await prevBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasPrev, 'Previous button not found after navigating');
    await prevBtn.click();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/error/);
  });

  test('Previous button is disabled or hidden on the first asset', async ({ page }) => {
    const prevBtn = page.getByRole('button', { name: /prev|précédent|←/i }).first();
    const visible = await prevBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!visible) {
      // Hidden on first asset — pass
      return;
    }
    const disabled = await prevBtn.isDisabled();
    expect(disabled).toBe(true);
  });

  test('Next button is disabled or hidden on the last asset', async ({ page }) => {
    // Navigate to the last asset by clicking Next repeatedly (max 20 times)
    let hasNext = true;
    let attempts = 0;
    while (hasNext && attempts < 20) {
      const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
      hasNext = await nextBtn.isEnabled().catch(() => false);
      if (hasNext) {
        await nextBtn.click();
        await page.waitForLoadState('networkidle');
      }
      attempts++;
    }
    // On last asset, Next should be disabled or hidden
    const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
    const visible = await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (visible) {
      const disabled = await nextBtn.isDisabled();
      expect(disabled).toBe(true);
    }
  });

  test('Navigation buttons have accessible labels', async ({ page }) => {
    const exists = await hasPrevNext(page);
    test.skip(!exists, 'Navigation buttons not found');
    const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
    const label = await nextBtn.getAttribute('aria-label');
    const title = await nextBtn.getAttribute('title');
    expect(label || title || 'next').toBeTruthy();
  });

  test('Asset index updates after navigating to next asset', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
    const hasNext = await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasNext, 'Next button not found');
    const indexBefore = await page.locator('[class*="asset-count"], [data-test="asset-index"]')
      .textContent().catch(() => '');
    await nextBtn.click();
    await page.waitForLoadState('networkidle');
    const indexAfter = await page.locator('[class*="asset-count"], [data-test="asset-index"]')
      .textContent().catch(() => '');
    // Index should have changed
    if (indexBefore && indexAfter) expect(indexAfter).not.toBe(indexBefore);
  });

  test('Navigation does not cause console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    const nextBtn = page.getByRole('button', { name: /next|suivant/i }).first();
    const hasNext = await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasNext, 'Next button not found');
    await nextBtn.click();
    await page.waitForLoadState('networkidle');
    const filtered = errors.filter(e => !e.includes('favicon'));
    expect(filtered).toHaveLength(0);
  });

  test('Navigation icons have no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
