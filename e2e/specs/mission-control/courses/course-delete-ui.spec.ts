/**
 * Optional cleanup spec — run manually after course-create.spec.ts
 * to delete the course that was created, leaving the environment clean.
 *
 * Usage: npx playwright test course-delete-ui.spec.ts --project=mission-control
 *
 * Set PLAYWRIGHT_MC_COURSE_UUID env var to the UUID of the course to delete,
 * OR the test will attempt to delete the most recently created course from the list.
 */
import { test, expect } from '../../../fixtures';

test.describe('Mission-Control — Course Delete via UI (optional cleanup)', () => {
  test('Delete course via UI delete button', async ({ page }) => {
    const courseUuid = process.env.PLAYWRIGHT_MC_COURSE_UUID;

    if (courseUuid) {
      await page.goto(`/course/${courseUuid}/overview`);
    } else {
      // Navigate to courses list and click the first available course
      await page.goto('/courses');
      await page.waitForLoadState('networkidle');
      const firstRow = page.locator('tr').filter({ has: page.locator('td') }).first();
      const hasRows = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false);
      test.skip(!hasRows, 'No courses found to delete');
      await firstRow.click();
      await page.waitForLoadState('networkidle');
    }

    await page.waitForLoadState('networkidle');

    const deleteButton = page.getByRole('button', { name: /delete/i });
    const deleteExists = await deleteButton.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!deleteExists, 'Delete button not visible on overview page');

    await deleteButton.click();

    // Confirmation modal/dialog
    const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i }).last();
    const confirmExists = await confirmButton.isVisible({ timeout: 5_000 }).catch(() => false);
    if (confirmExists) {
      await confirmButton.click();
    }

    await page.waitForLoadState('networkidle');
    // Should redirect back to courses list after deletion
    await expect(page).toHaveURL(/courses(?!\/.+\/overview)/);
  });
});
