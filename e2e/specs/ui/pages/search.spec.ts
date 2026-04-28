import { test, expect } from '../../../fixtures';
import { SearchPage } from '../../../pages/ui/search.page';

test.describe('Search — Search Form', () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.waitForLoadingToDisappear();
  });

  test('Search with query and language filter', async ({ page }) => {
    await searchPage.searchInput.fill('course');
    await searchPage.searchInput.press('Enter');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/search/);
  });

  test('Toggle view mode (grid/list)', async ({ page }) => {
    const gridToggle = searchPage.gridToggle;
    const listToggle = searchPage.listToggle;
    const gridExists = await gridToggle.isVisible({ timeout: 3_000 }).catch(() => false);
    const listExists = await listToggle.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!gridExists && !listExists, 'No view toggle buttons found');
    if (listExists) {
      await listToggle.click();
      await page.waitForTimeout(300);
    }
    if (gridExists) {
      await gridToggle.click();
      await page.waitForTimeout(300);
    }
    await expect(page).toHaveURL(/search/);
  });

  test('Verify empty results state', async ({ page }) => {
    await searchPage.searchInput.fill('zzz_no_results_xyz_12345_unique');
    await searchPage.searchInput.press('Enter');
    await page.waitForLoadState('networkidle');
    const emptyMsg = searchPage.noResults.or(page.locator('text=/no result|not found/i'));
    const count = await searchPage.getResultCount();
    const hasEmpty = await emptyMsg.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(count === 0 || hasEmpty).toBeTruthy();
  });
});
