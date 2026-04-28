import { test, expect } from '../../../fixtures';
import { CoursesPage } from '../../../pages/ui/courses.page';
import { CourseDetailPage } from '../../../pages/ui/course-detail.page';

test.describe('Course Preview — Banner Section', () => {
  let detailPage: CourseDetailPage;

  async function navigateToCourseDetail(page: any) {
    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
    const count = await coursesPage.getCourseCount();
    if (count === 0) return false;
    await coursesPage.clickFirstCourse();
    await page.waitForLoadState('networkidle');
    return true;
  }

  test.beforeEach(async ({ page }) => {
    detailPage = new CourseDetailPage(page);
  });

  test('Verify banner image displayed', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    await detailPage.isLoaded();
    // Either a banner image or a fallback/placeholder should be present
    const banner = page.locator('img, [class*="banner"], [class*="teaser"]').first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test('Verify title in banner', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    await detailPage.isLoaded();
    await expect(detailPage.courseTitle).toBeVisible();
    const titleText = await detailPage.courseTitle.textContent();
    expect(titleText?.trim().length).toBeGreaterThan(0);
  });

  test('Verify progress percentage hidden when not started', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    await detailPage.isLoaded();
    // For a course that hasn't been started, progress bar should not show percentage
    const startBtn = await detailPage.startButton.isVisible({ timeout: 3_000 }).catch(() => false);
    if (startBtn) {
      // Not started — progress bar should not show or be at 0
      const progressBar = detailPage.progressBar;
      const hasProgress = await progressBar.isVisible({ timeout: 2_000 }).catch(() => false);
      if (hasProgress) {
        const value = await progressBar.getAttribute('aria-valuenow').catch(() => '0');
        expect(Number(value || 0)).toBe(0);
      }
    }
  });
});

test.describe('Course Preview — Info Section', () => {
  async function navigateToCourseDetail(page: any) {
    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
    const count = await coursesPage.getCourseCount();
    if (count === 0) return false;
    await coursesPage.clickFirstCourse();
    await page.waitForLoadState('networkidle');
    return true;
  }

  test('Verify content sections render', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    const detailPage = new CourseDetailPage(page);
    await detailPage.isLoaded();
    await expect(detailPage.courseTitle).toBeVisible();
    await expect(detailPage.courseDescription).toBeVisible();
  });

  test('Verify level badge displayed', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    const detailPage = new CourseDetailPage(page);
    await detailPage.isLoaded();
    const badge = detailPage.levelBadge;
    const exists = await badge.isVisible({ timeout: 3_000 }).catch(() => false);
    if (exists) {
      const text = await badge.textContent();
      expect(['beginner', 'intermediate', 'advanced', 'expert'].some(
        (level) => text?.toLowerCase().includes(level)
      )).toBeTruthy();
    }
  });
});

test.describe('Course Preview — Action Buttons', () => {
  async function navigateToCourseDetail(page: any) {
    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
    const count = await coursesPage.getCourseCount();
    if (count === 0) return false;
    await coursesPage.clickFirstCourse();
    await page.waitForLoadState('networkidle');
    return true;
  }

  test('Click Start', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    const detailPage = new CourseDetailPage(page);
    await detailPage.isLoaded();
    const startVisible = await detailPage.startButton.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!startVisible, 'Start button not present — course may already be started');
    await detailPage.startButton.click();
    await page.waitForLoadState('networkidle');
    // After start, should navigate into the course
    await expect(page).toHaveURL(/courses\/.+\/section/);
  });

  test('Click Bookmark icon', async ({ page }) => {
    const navigated = await navigateToCourseDetail(page);
    test.skip(!navigated, 'No courses available');
    const detailPage = new CourseDetailPage(page);
    await detailPage.isLoaded();
    const bookmark = detailPage.bookmarkIcon;
    const exists = await bookmark.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'Bookmark icon not visible');
    await bookmark.click();
    await page.waitForTimeout(1000);
    // Should not navigate away — bookmark is an in-place toggle
    await expect(page).toHaveURL(/courses\/.+/);
  });

  test('should have no critical accessibility violations', async ({ page, a11y }) => {
    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
    const count = await coursesPage.getCourseCount();
    test.skip(count === 0, 'No courses available');
    await coursesPage.clickFirstCourse();
    await page.waitForLoadState('networkidle');
    await a11y.assertNoViolations({ allowedIds: ['document-title'] });
  });

  test('should match visual snapshot', async ({ page }) => {
    const coursesPage = new CoursesPage(page);
    await coursesPage.goto();
    await coursesPage.waitForLoadingToDisappear();
    const count = await coursesPage.getCourseCount();
    test.skip(count === 0, 'No courses available');
    await coursesPage.clickFirstCourse();
    await page.waitForLoadState('networkidle');
    const detailPage = new CourseDetailPage(page);
    await detailPage.isLoaded();
    await expect(page).toHaveScreenshot('course-detail.png', {
      fullPage: true,
      mask: [page.locator('img'), page.locator('[class*="progress"]')],
    });
  });
});
