import { test, expect } from '../../../fixtures';
import { ProjectCreatePage } from '../../../pages/studio-web/project-create.page';
import { ProjectsListPage } from '../../../pages/studio-web/projects-list.page';
import { TestData } from '../../../utils/test-data';

/**
 * Lifecycle test — creates a real project in Studio-Web.
 * Read-only assertions only after creation (no auto-delete).
 * Use project-delete-ui.spec.ts or project-delete-api.spec.ts to clean up.
 */
test.describe('Studio-Web — Project Creation Lifecycle', () => {
  test('Create new project and verify on teaser step', async ({ page }) => {
    const listPage = new ProjectsListPage(page);
    const createPage = new ProjectCreatePage(page);
    const projectName = `[AUTO] ${TestData.project.name()}`;

    // Step 0 — navigate to projects list and click Create
    await listPage.goto();
    await listPage.waitForLoadingToDisappear();
    await listPage.createProjectButton.click();

    // Capture POST /o/course/projects request
    let projectCreated = false;
    page.on('request', req => {
      if (req.url().includes('/o/course/projects') && req.method() === 'POST') {
        projectCreated = true;
      }
    });

    // Step 1 — fill project name and submit
    await createPage.nameInput.waitFor({ state: 'visible', timeout: 10_000 });
    await createPage.nameInput.fill(projectName);
    await createPage.submitButton.click();

    // Step 2 — fill content details if we land on step 2
    const step2Visible = await createPage.titleInput.isVisible({ timeout: 5_000 }).catch(() => false);
    if (step2Visible) {
      await createPage.titleInput.fill(TestData.course.title());
      await createPage.step2SubmitButton.click();
    }

    // Assert project UUID appears in URL (teaser or overview step)
    await page.waitForURL(url => /[0-9a-f-]{36}/.test(url.pathname), { timeout: 20_000 });
    const uuid = await createPage.getProjectUuidFromUrl();
    expect(uuid).toBeTruthy();
    console.log(`[project-create] Created project UUID: ${uuid}`);

    // Assert we left the creation form — landed on a project page
    await expect(page).not.toHaveURL(/\/project\/new/);
  });
});
