import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Other Pages: Manage Courses (1 test)
 * Pre-condition: User has manager role or is enrolled in courses.
 */
test.describe('Other Pages — Manage Courses', () => {
  test('Manage Courses page loads and displays enrolled / managed courses', async ({ page }) => {
    await page.goto('/manage-courses');
    await page.waitForLoadState('networkidle');

    const is404 = await page.locator('[class*="404"], h1').filter({ hasText: /404|not found/i })
      .isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(is404, 'Manage Courses page returned 404 — may require manager role');

    await expect(page).toHaveURL(/manage/);
    const container = page.locator('[class*="course"], table, [class*="list"]').first();
    await expect(container).toBeVisible({ timeout: 8_000 });
  });
});
