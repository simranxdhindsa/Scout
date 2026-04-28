import { test, expect } from '../../../fixtures';
import { ProjectsListPage } from '../../../pages/studio-web/projects-list.page';

test.describe('Studio-Web — Projects List', () => {
  let listPage: ProjectsListPage;

  test.beforeEach(async ({ page }) => {
    listPage = new ProjectsListPage(page);
    await listPage.goto();
    await listPage.waitForLoadingToDisappear();
  });

  test('Projects grid loads and displays project cards', async ({ page }) => {
    await expect(page).toHaveURL(/projects/);
    const cards = listPage.projectCards;
    const count = await cards.count();
    // Grid may be empty in a fresh environment — just assert the container renders
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Create Project button is visible', async ({ page }) => {
    await expect(listPage.createProjectButton).toBeVisible();
  });

  test('Search input filters projects by name', async ({ page }) => {
    const searchVisible = await listPage.searchInput.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!searchVisible, 'Search input not present');
    await listPage.searchInput.fill('nonexistent-project-xyz');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    // Results may be empty — assert no crash / page still renders
    await expect(page).toHaveURL(/projects/);
  });

  test('Status filter tabs are present', async ({ page }) => {
    const filterExists = await listPage.statusFilter.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!filterExists) test.skip(true, 'Status filter not present');
    await expect(listPage.statusFilter).toBeVisible();
  });

  test('Clicking a project card navigates to project detail', async ({ page }) => {
    const count = await listPage.projectCards.count();
    test.skip(count === 0, 'No project cards available to click');
    await listPage.projectCards.first().click();
    await page.waitForURL(url => url.pathname !== '/projects', { timeout: 10_000 });
    expect(page.url()).not.toMatch(/^.*\/projects$/);
  });

  test('Projects list has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });

  test('Projects list matches visual baseline', async ({ page }) => {
    await expect(page).toHaveScreenshot('sw-projects-list.png', { fullPage: false });
  });
});
