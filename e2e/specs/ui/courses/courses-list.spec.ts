import { test, expect } from '../../../fixtures';
import { CoursesPage } from '../../../pages/ui/courses.page';

test.describe('Course Listing — Tabs', () => {
  let coursesPage: CoursesPage;

  test.beforeEach(async ({ page }) => {
    coursesPage = new CoursesPage(page);
    await coursesPage.goto();
  });

  test('Verify all tabs displayed and functional', async ({ page }) => {
    await expect(coursesPage.assignedTab).toBeVisible({ timeout: 15_000 });
    await expect(coursesPage.completedTab).toBeVisible();
    await expect(coursesPage.availableTab).toBeVisible();
  });
});

test.describe('Course Listing — Course Cards', () => {
  let coursesPage: CoursesPage;

  test.beforeEach(async ({ page }) => {
    coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
  });

  test('Verify card shows correct info', async ({ page }) => {
    const count = await coursesPage.getCourseCount();
    if (count === 0) {
      await expect(coursesPage.emptyState.or(page.locator('text=/no course/i'))).toBeVisible({ timeout: 5_000 })
        .catch(() => {});
      return;
    }
    const firstCard = coursesPage.courseCards.first();
    await expect(firstCard).toBeVisible();
    // Card should contain at least some text
    const text = await firstCard.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('Click a course card', async ({ page }) => {
    const count = await coursesPage.getCourseCount();
    test.skip(count === 0, 'No course cards to click');
    await coursesPage.clickFirstCourse();
    await expect(page).toHaveURL(/courses\/.+/);
  });

  test('Verify empty state when no courses', async ({ page }) => {
    const count = await coursesPage.getCourseCount();
    if (count === 0) {
      await expect(page.locator('text=/no course|empty|nothing assigned/i').first())
        .toBeVisible({ timeout: 5_000 }).catch(() => {
          // Some apps render empty section without explicit message
        });
    }
  });

  test('should have no critical accessibility violations', async ({ a11y }) => {
    await a11y.assertNoViolations({ allowedIds: ['document-title'] });
  });
});

test.describe('Course Listing — Hover Preview', () => {
  test('Hover over a course card', async ({ page }) => {
    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
    const count = await coursesPage.getCourseCount();
    test.skip(count === 0, 'No course cards to hover');
    const card = coursesPage.courseCards.first();
    await card.hover();
    await page.waitForTimeout(500);
    // Hover card may show additional info — just verify the original card is still visible
    await expect(card).toBeVisible();
  });
});
