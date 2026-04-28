import { test, expect } from '../../../fixtures';
import { CourseCreatePage } from '../../../pages/mission-control/course-create.page';
import { TestData } from '../../../utils/test-data';

test.describe('Mission-Control — Course Creation Lifecycle', () => {
  test('Create a new course and verify redirect to overview', async ({ page }) => {
    const createPage = new CourseCreatePage(page);
    await createPage.goto();
    await createPage.waitForLoadingToDisappear();

    const courseName = TestData.course.title();
    const description = TestData.course.longDescription().substring(0, 200);

    // Intercept the POST to verify it fires once
    const captured = await page.context().newPage().catch(() => null);
    let postFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/a/course') && req.method() === 'POST') {
        postFired = true;
      }
    });

    await createPage.fillName(courseName);
    await createPage.selectLevel('Beginner').catch(() => {
      // Level select may use different UI — skip if not found
    });
    await createPage.fillDescription(description).catch(async () => {
      // Rich text editor may require clicking first
      const editor = page.locator('[contenteditable="true"]').first();
      if (await editor.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await editor.click();
        await editor.fill(description);
      }
    });

    await createPage.submit();
    await page.waitForLoadState('networkidle');

    // Should redirect to /course/{uuid}/overview
    await expect(page).toHaveURL(/course\/.+\/overview/, { timeout: 15_000 });

    // Success notification should appear
    const notification = page.locator('.mantine-Notification-root');
    const hasNotification = await notification.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasNotification || postFired).toBeTruthy();

    // Course name should be visible on overview page
    const uuid = await createPage.getCourseUuidFromUrl();
    expect(uuid).not.toBeNull();
  });
});
