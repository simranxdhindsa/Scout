import { test, expect } from '../../../fixtures';
import { ProjectsListPage } from '../../../pages/studio-web/projects-list.page';

/**
 * Optional cleanup — delete a Studio-Web project via API.
 * Set PLAYWRIGHT_SW_PROJECT_UUID in .env.e2e before running.
 * Run independently: npx playwright test project-delete-api --project=studio-web
 */
test.describe('Studio-Web — Delete Project via API (optional cleanup)', () => {
  test('Delete project via DELETE /o/course/projects/{uuid}', async ({ request, page }) => {
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID;
    const baseUrl = process.env.PLAYWRIGHT_SW_URL ?? '';
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set — skipping cleanup');
    test.skip(!baseUrl, 'PLAYWRIGHT_SW_URL not configured');

    const response = await request.delete(`${baseUrl}/o/course/projects/${uuid}`);
    expect([200, 204]).toContain(response.status());

    // Verify project no longer appears in list
    const listPage = new ProjectsListPage(page);
    await listPage.goto();
    await listPage.waitForLoadingToDisappear();
    const uuidInPage = await page.locator(`[href*="${uuid}"]`).count();
    expect(uuidInPage).toBe(0);
  });
});
