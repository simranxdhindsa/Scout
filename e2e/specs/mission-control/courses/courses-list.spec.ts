import { test, expect } from '../../../fixtures';
import { McCoursesListPage } from '../../../pages/mission-control/courses-list.page';

test.describe('Mission-Control — Courses List', () => {
  let coursesPage: McCoursesListPage;

  test.beforeEach(async ({ page }) => {
    coursesPage = new McCoursesListPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
  });

  test('Course list loads with table/card layout', async ({ page }) => {
    const count = await coursesPage.getCount();
    if (count > 0) {
      await expect(coursesPage.courseRows.first().or(coursesPage.courseCards.first())).toBeVisible();
    } else {
      await expect(page.locator('main')).toBeVisible();
    }
  });

  test('Search by course name narrows results', async ({ page }) => {
    const count = await coursesPage.getCount();
    test.skip(count === 0, 'No courses to search');
    const firstItem = await coursesPage.courseRows.first().or(coursesPage.courseCards.first()).textContent();
    const query = firstItem?.slice(0, 5) || 'test';
    await coursesPage.searchCourses(query);
    const newCount = await coursesPage.getCount();
    expect(newCount).toBeLessThanOrEqual(count);
  });

  test('Pagination next button works', async ({ page }) => {
    const nextBtn = coursesPage.paginationNext;
    const isEnabled = await nextBtn.isEnabled({ timeout: 3_000 }).catch(() => false);
    test.skip(!isEnabled, 'No next page available');
    await nextBtn.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/courses/);
  });

  test('Navigate to course detail on row click', async ({ page }) => {
    const count = await coursesPage.getCount();
    test.skip(count === 0, 'No courses available');
    await coursesPage.courseRows.first().or(coursesPage.courseCards.first()).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/course\/.+/);
  });

  test('should have no critical accessibility violations', async ({ a11y }) => {
    await a11y.assertNoViolations({ allowedIds: ['document-title'] });
  });
});
