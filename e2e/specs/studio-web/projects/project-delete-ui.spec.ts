import { test, expect } from '../../../fixtures';
import { ProjectsListPage } from '../../../pages/studio-web/projects-list.page';

/**
 * Optional cleanup — delete a Studio-Web project via the UI.
 * Set PLAYWRIGHT_SW_PROJECT_UUID in .env.e2e before running.
 * Run independently: npx playwright test project-delete-ui --project=studio-web
 */
test.describe('Studio-Web — Delete Project via UI (optional cleanup)', () => {
  test('Delete project by UUID from overview page', async ({ page }) => {
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID;
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set — skipping cleanup');

    await page.goto(`/project/${uuid}/overview`);
    await page.waitForLoadState('networkidle');

    const deleteBtn = page.getByRole('button', { name: /delete|supprimer/i });
    const deleteVisible = await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!deleteVisible, 'Delete button not found on project overview');

    await deleteBtn.click();

    // Confirm modal
    const modal = page.locator('.mantine-Modal-root');
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    const confirmBtn = modal.getByRole('button', { name: /confirm|delete|yes|oui/i });
    await confirmBtn.click();

    // Assert redirect to projects list
    await page.waitForURL(/\/projects$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/projects/);

    // Assert project no longer in list
    const listPage = new ProjectsListPage(page);
    await listPage.waitForLoadingToDisappear();
    const uuidInPage = await page.locator(`[href*="${uuid}"]`).count();
    expect(uuidInPage).toBe(0);
  });
});
