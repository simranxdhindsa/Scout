import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COURSES_URL = '/courses';
const SIGN_IN_URL = '/auth/signIn';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
interface CourseCard {
  uuid: string;
  name: string;
  description?: string;
  level?: string;
  course_completed?: boolean;
  assignment_id?: string | null;
}

function buildCourseCard(overrides: CourseCard): CourseCard {
  return {
    description: 'A sample course description.',
    level: 'Beginner',
    course_completed: false,
    assignment_id: null,
    ...overrides,
  };
}

function buildCourseListResponse(courses: CourseCard[]) {
  return {
    data: courses,
    meta: { current: 0, pages: 1, total: courses.length },
  };
}

const COURSE_A = buildCourseCard({ uuid: 'course-uuid-1', name: 'React Fundamentals', assignment_id: 'assign-1' });
const COURSE_B = buildCourseCard({ uuid: 'course-uuid-2', name: 'Advanced Node.js', course_completed: true });
const COURSE_C = buildCourseCard({ uuid: 'course-uuid-3', name: 'Docker for Beginners' });

// ---------------------------------------------------------------------------
// Mock helpers
//
// Patterns are mutually exclusive so route registration order does not matter:
//   /general/dashboard/courses/assigned   → assigned mock
//   /general/dashboard/courses/completed  → completed mock
//   /general/dashboard/courses?…          → available mock (only when followed by ?)
// ---------------------------------------------------------------------------
const isApiRequest = (route: Route) =>
  route.request().resourceType() === 'fetch' || route.request().resourceType() === 'xhr';

async function mockAssignedCoursesApi(page: Page, courses: CourseCard[] = [COURSE_A]) {
  await page.route(/\/general\/dashboard\/courses\/assigned/, (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses)),
    });
  });
}

async function mockCompletedCoursesApi(page: Page, courses: CourseCard[] = [COURSE_B]) {
  await page.route(/\/general\/dashboard\/courses\/completed/, (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses)),
    });
  });
}

async function mockAvailableCoursesApi(page: Page, courses: CourseCard[] = [COURSE_C]) {
  // Only matches `/o/general/dashboard/courses?...`, NOT `/courses/assigned` or `/courses/completed`
  await page.route(/\/general\/dashboard\/courses\?/, (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses)),
    });
  });
}

async function setupPage(page: Page) {
  await mockAssignedCoursesApi(page);
  await mockCompletedCoursesApi(page);
  await mockAvailableCoursesApi(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const assignedTab = (page: Page) => page.getByRole('tab', { name: 'Assigned Courses' });
const completedTab = (page: Page) => page.getByRole('tab', { name: 'Completed Courses' });
const availableTab = (page: Page) => page.getByRole('tab', { name: 'Available Courses' });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Course List page (/courses)', () => {
  test.describe('Authentication', () => {
    test('unauthenticated user is redirected to /auth/signIn', async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();
      await page.goto(COURSES_URL);
      await expect(page).toHaveURL(new RegExp(SIGN_IN_URL));
      await context.close();
    });
  });

  test.describe('Rendering', () => {
    test.beforeEach(async ({ page }) => {
      await setupPage(page);
    });

    test('renders all three course tabs', async ({ page }) => {
      await page.goto(COURSES_URL);
      await expect(assignedTab(page)).toBeVisible({ timeout: 10000 });
      await expect(completedTab(page)).toBeVisible();
      await expect(availableTab(page)).toBeVisible();
    });

    test('renders assigned courses in the default tab', async ({ page }) => {
      await page.goto(COURSES_URL);
      // Default tab is "assigned-courses"; the mocked card should appear
      await expect(page.getByText('React Fundamentals')).toBeVisible({ timeout: 10000 });
    });

    test('shows empty-state message when there are no assigned courses', async ({ page }) => {
      await mockAssignedCoursesApi(page, []);
      await page.goto(COURSES_URL);
      await expect(
        page.getByText('You do not have any assigned courses yet')
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Tab switching', () => {
    test.beforeEach(async ({ page }) => {
      await setupPage(page);
    });

    test('clicking Completed Courses tab updates URL to ?tab=completed-courses', async ({ page }) => {
      await page.goto(COURSES_URL);
      await expect(assignedTab(page)).toBeVisible({ timeout: 10000 });
      await completedTab(page).click();
      await expect(page).toHaveURL(/tab=completed-courses/, { timeout: 5000 });
    });

    test('clicking Available Courses tab updates URL to ?tab=available-courses', async ({ page }) => {
      await page.goto(COURSES_URL);
      await expect(assignedTab(page)).toBeVisible({ timeout: 10000 });
      await availableTab(page).click();
      await expect(page).toHaveURL(/tab=available-courses/, { timeout: 5000 });
    });

    test('navigating directly to ?tab=completed-courses renders completed courses', async ({ page }) => {
      await page.goto(`${COURSES_URL}?tab=completed-courses`);
      await expect(completedTab(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Advanced Node.js')).toBeVisible({ timeout: 10000 });
    });

    test('navigating directly to ?tab=available-courses renders available courses', async ({ page }) => {
      await page.goto(`${COURSES_URL}?tab=available-courses`);
      await expect(availableTab(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Docker for Beginners')).toBeVisible({ timeout: 10000 });
    });

    test('shows empty-state message when there are no completed courses', async ({ page }) => {
      await mockCompletedCoursesApi(page, []);
      await page.goto(`${COURSES_URL}?tab=completed-courses`);
      await expect(
        page.getByText('You have not completed any courses yet')
      ).toBeVisible({ timeout: 10000 });
    });

    test('shows empty-state message when there are no available courses', async ({ page }) => {
      await mockAvailableCoursesApi(page, []);
      await page.goto(`${COURSES_URL}?tab=available-courses`);
      await expect(
        page.getByText('No courses are available right now')
      ).toBeVisible({ timeout: 10000 });
    });
  });
});
