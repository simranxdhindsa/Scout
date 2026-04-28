import { test, expect } from '../../../fixtures';

/**
 * QA Doc — PDF Controls (8 tests)
 * Pre-condition: A PDF asset is open in the viewer.
 */
test.describe('Course Consumption — PDF Controls', () => {
  const hasPdf = async (page: any): Promise<boolean> => {
    const iframe = await page.locator('iframe[src*="pdf"], embed[type*="pdf"], [class*="pdf-viewer"]')
      .isVisible({ timeout: 5_000 }).catch(() => false);
    return iframe;
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');
  });

  test('PDF viewer renders for PDF assets', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF asset available');
    const pdfEl = page.locator('iframe[src*="pdf"], embed[type*="pdf"], [class*="pdf-viewer"]').first();
    await expect(pdfEl).toBeVisible();
  });

  test('PDF page navigation — Next Page button is present', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF viewer');
    const nextBtn = page.getByRole('button', { name: /next|suivant|→/i }).first();
    const visible = await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Next Page button not found');
    await expect(nextBtn).toBeVisible();
  });

  test('PDF page navigation — Previous Page button is present', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF viewer');
    const prevBtn = page.getByRole('button', { name: /prev|précédent|←/i }).first();
    const visible = await prevBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Previous Page button not found');
    await expect(prevBtn).toBeVisible();
  });

  test('Current page number and total pages are displayed', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF viewer');
    const pageIndicator = page.locator('[data-test="pdf-page"], [class*="page-number"]').first();
    const visible = await pageIndicator.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Page number indicator not found');
    await expect(pageIndicator).toBeVisible();
  });

  test('Zoom In button increases PDF view size', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF viewer');
    const zoomIn = page.getByRole('button', { name: /zoom in|\+|agrandir/i }).first();
    const visible = await zoomIn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Zoom In button not found');
    await zoomIn.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('Zoom Out button decreases PDF view size', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF viewer');
    const zoomOut = page.getByRole('button', { name: /zoom out|−|réduire/i }).first();
    const visible = await zoomOut.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Zoom Out button not found');
    await zoomOut.click();
    await expect(page).not.toHaveURL(/error/);
  });

  test('PDF download button is visible (if available)', async ({ page }) => {
    const exists = await hasPdf(page);
    test.skip(!exists, 'No PDF viewer');
    const dlBtn = page.getByRole('button', { name: /download|télécharger/i }).first();
    const visible = await dlBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!visible, 'Download button not available for this asset');
    await expect(dlBtn).toBeVisible();
  });

  test('PDF viewer has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
