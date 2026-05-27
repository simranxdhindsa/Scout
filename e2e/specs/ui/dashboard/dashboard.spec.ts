import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DASHBOARD_URL = '/dashboard';
const CATALOG_URL_REGEX = /\/courses\?tab=assigned-courses/;

const ASSIGNED_TITLE = 'Courses assigned to you!';
const COMPLETED_TITLE = "Courses you've Completed!";
const AVAILABLE_TITLE = 'Available Courses';

const NO_ASSIGNED_TEXT = 'You do not have any assigned courses yet';
const NO_COMPLETED_TEXT = 'You have not completed any courses yet';
const NO_AVAILABLE_TEXT = 'No courses are available right now';

const SEE_CATALOG_TEXT = 'See the entire catalog';

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

function buildCourseListResponse(courses: CourseCard[], totalNotVisited = 0) {
  return {
    data: courses,
    meta: {
      current: 0,
      pages: 1,
      total: courses.length,
      info: { total_not_visited: totalNotVisited },
    },
  };
}

function buildUserProfile() {
  return { data: { uuid: 'u1', language: 'en', theme: null } };
}

const ASSIGNED_A = buildCourseCard({ uuid: 'assigned-1', name: 'React Fundamentals', assignment_id: 'a-1' });
const ASSIGNED_B = buildCourseCard({ uuid: 'assigned-2', name: 'TypeScript Deep Dive', assignment_id: 'a-2' });
const COMPLETED_A = buildCourseCard({
  uuid: 'completed-1',
  name: 'Advanced Node.js',
  course_completed: true,
});
const AVAILABLE_A = buildCourseCard({ uuid: 'available-1', name: 'Docker for Beginners' });
const AVAILABLE_B = buildCourseCard({ uuid: 'available-2', name: 'Kubernetes 101' });

// ---------------------------------------------------------------------------
// Mocks
//
// Patterns are mutually exclusive so route registration order does not matter:
//   /general/dashboard/courses/assigned   → assigned mock
//   /general/dashboard/courses/completed  → completed mock
//   /general/dashboard/courses?…          → available/suggestions mock (only when followed by ?)
// ---------------------------------------------------------------------------
function isApi(route: Route) {
  const t = route.request().resourceType();
  return t === 'fetch' || t === 'xhr';
}

async function mockUserProfile(page: Page) {
  await page.route('**/user/profile**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserProfile()),
    });
  });
}

async function mockAssignedCourses(
  page: Page,
  courses: CourseCard[] = [ASSIGNED_A, ASSIGNED_B],
  totalNotVisited = 0,
  onCall?: (url: string) => void
) {
  await page.route(/\/general\/dashboard\/courses\/assigned/, (route) => {
    if (!isApi(route)) return route.fallback();
    if (route.request().method() !== 'GET') return route.continue();
    if (onCall) onCall(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses, totalNotVisited)),
    });
  });
}

async function mockCompletedCourses(page: Page, courses: CourseCard[] = [COMPLETED_A]) {
  await page.route(/\/general\/dashboard\/courses\/completed/, (route) => {
    if (!isApi(route)) return route.fallback();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses)),
    });
  });
}

async function mockAvailableCourses(
  page: Page,
  courses: CourseCard[] = [AVAILABLE_A, AVAILABLE_B],
  onCall?: (url: string) => void
) {
  // Only matches `/o/general/dashboard/courses?...`, NOT `/courses/assigned` or `/courses/completed`
  await page.route(/\/general\/dashboard\/courses\?/, (route) => {
    if (!isApi(route)) return route.fallback();
    if (route.request().method() !== 'GET') return route.continue();
    if (onCall) onCall(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses)),
    });
  });
}

async function setupPage(
  page: Page,
  opts: {
    assigned?: CourseCard[];
    completed?: CourseCard[];
    available?: CourseCard[];
    totalNotVisited?: number;
  } = {}
) {
  await mockUserProfile(page);
  await mockAssignedCourses(page, opts.assigned, opts.totalNotVisited);
  await mockCompletedCourses(page, opts.completed);
  await mockAvailableCourses(page, opts.available);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const assignedTitle = (page: Page) =>
  page.getByRole('heading', { name: ASSIGNED_TITLE, exact: true });
const completedTitle = (page: Page) =>
  page.getByRole('heading', { name: COMPLETED_TITLE, exact: true });
const availableTitle = (page: Page) =>
  page.getByRole('heading', { name: AVAILABLE_TITLE, exact: true });

const seeCatalogButton = (page: Page) =>
  page.getByRole('button', { name: SEE_CATALOG_TEXT, exact: true });

// Section root locators — used to scope arrow-button clicks to a single carousel.
// Each section is a Mantine Stack with the title heading at the top.
const sectionByTitle = (page: Page, title: string) =>
  page
    .locator(
      `xpath=//*[self::h1 or self::h2 or self::h3 or self::h4][normalize-space()=${JSON.stringify(title)}]/ancestor::*[contains(@class,'mantine-Stack-root')][1]`
    )
    .first();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Dashboard — Home', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(DASHBOARD_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders all three section titles', async ({ page }) => {
      await setupPage(page);
      await page.goto(DASHBOARD_URL);

      await expect(assignedTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(completedTitle(page)).toBeVisible();
      await expect(availableTitle(page)).toBeVisible();
    });

    test('renders course cards returned by each section API', async ({ page }) => {
      await setupPage(page);
      await page.goto(DASHBOARD_URL);

      await expect(assignedTitle(page)).toBeVisible({ timeout: 10000 });

      await expect(page.getByText(ASSIGNED_A.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(ASSIGNED_B.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(COMPLETED_A.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(AVAILABLE_A.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(AVAILABLE_B.name, { exact: false }).first()).toBeVisible();
    });

    test('shows the "not visited" badge when assigned API reports unread courses', async ({ page }) => {
      await setupPage(page, { totalNotVisited: 5 });
      await page.goto(DASHBOARD_URL);

      await expect(assignedTitle(page)).toBeVisible({ timeout: 10000 });
      // Badge text shows the count next to the assigned title
      await expect(page.getByText('5', { exact: true }).first()).toBeVisible();
    });

    test('hides the "not visited" badge when count is zero', async ({ page }) => {
      await setupPage(page, { totalNotVisited: 0 });
      await page.goto(DASHBOARD_URL);

      await expect(assignedTitle(page)).toBeVisible({ timeout: 10000 });
      // No standalone "0" badge near the title
      await expect(
        page.locator('xpath=//*[contains(@class,"mantine-Badge-root")][normalize-space()="0"]')
      ).toHaveCount(0);
    });

    test('renders the "See the entire catalog" CTA at the bottom', async ({ page }) => {
      await setupPage(page);
      await page.goto(DASHBOARD_URL);

      await expect(seeCatalogButton(page)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Empty states', () => {
    test('shows empty message when there are no assigned courses', async ({ page }) => {
      await setupPage(page, { assigned: [] });
      await page.goto(DASHBOARD_URL);

      await expect(page.getByText(NO_ASSIGNED_TEXT)).toBeVisible({ timeout: 10000 });
    });

    test('shows empty message when there are no completed courses', async ({ page }) => {
      await setupPage(page, { completed: [] });
      await page.goto(DASHBOARD_URL);

      await expect(page.getByText(NO_COMPLETED_TEXT)).toBeVisible({ timeout: 10000 });
    });

    test('shows empty message when there are no available courses', async ({ page }) => {
      await setupPage(page, { available: [] });
      await page.goto(DASHBOARD_URL);

      await expect(page.getByText(NO_AVAILABLE_TEXT)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Network', () => {
    test('GET /general/dashboard/courses/assigned forwards page=0&size=10', async ({ page }) => {
      await mockUserProfile(page);
      await mockCompletedCourses(page);
      await mockAvailableCourses(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/general\/dashboard\/courses\/assigned\?/.test(r.url()) &&
          r.url().includes('size=10') &&
          r.url().includes('page=0')
      );

      await mockAssignedCourses(page);
      await page.goto(DASHBOARD_URL);
      await req;
    });

    test('GET /general/dashboard/courses forwards size=8 for suggestions section', async ({ page }) => {
      await mockUserProfile(page);
      await mockAssignedCourses(page);
      await mockCompletedCourses(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/general\/dashboard\/courses\?/.test(r.url()) &&
          r.url().includes('size=8')
      );

      await mockAvailableCourses(page);
      await page.goto(DASHBOARD_URL);
      await req;
    });
  });

  test.describe('Interaction', () => {
    test('carousel prev button is disabled on initial render for each section', async ({ page }) => {
      // 6+ cards so next is enabled but prev starts disabled.
      const many = Array.from({ length: 6 }, (_, i) =>
        buildCourseCard({ uuid: `assigned-${i}`, name: `Assigned Course ${i}` })
      );
      await setupPage(page, { assigned: many });
      await page.goto(DASHBOARD_URL);

      const section = sectionByTitle(page, ASSIGNED_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });

      const buttons = section.locator('button');
      // The carousel header has exactly two arrow ActionIcons — prev then next.
      await expect(buttons.nth(0)).toBeDisabled();
      await expect(buttons.nth(1)).toBeEnabled();
    });

    test('clicking next then prev re-disables the prev button', async ({ page }) => {
      const many = Array.from({ length: 6 }, (_, i) =>
        buildCourseCard({ uuid: `assigned-${i}`, name: `Assigned Course ${i}` })
      );
      await setupPage(page, { assigned: many });
      await page.goto(DASHBOARD_URL);

      const section = sectionByTitle(page, ASSIGNED_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });

      const buttons = section.locator('button');
      await buttons.nth(1).click();
      await expect(buttons.nth(0)).toBeEnabled();

      await buttons.nth(0).click();
      await expect(buttons.nth(0)).toBeDisabled();
    });

    test('hides carousel arrows when a section has no courses', async ({ page }) => {
      await setupPage(page, { assigned: [] });
      await page.goto(DASHBOARD_URL);

      await expect(page.getByText(NO_ASSIGNED_TEXT)).toBeVisible({ timeout: 10000 });

      const section = sectionByTitle(page, ASSIGNED_TITLE);
      // Empty assigned section renders no arrow ActionIcons.
      await expect(section.locator('button')).toHaveCount(0);
    });
  });

  test.describe('Navigation', () => {
    test('"See the entire catalog" navigates to /courses?tab=assigned-courses', async ({ page }) => {
      await setupPage(page);
      await page.goto(DASHBOARD_URL);

      await expect(seeCatalogButton(page)).toBeVisible({ timeout: 10000 });
      await seeCatalogButton(page).click();

      await expect(page).toHaveURL(CATALOG_URL_REGEX, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('renders all three section titles even when every section is empty', async ({ page }) => {
      await setupPage(page, { assigned: [], completed: [], available: [] });
      await page.goto(DASHBOARD_URL);

      await expect(assignedTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(completedTitle(page)).toBeVisible();
      await expect(availableTitle(page)).toBeVisible();

      await expect(page.getByText(NO_ASSIGNED_TEXT)).toBeVisible();
      await expect(page.getByText(NO_COMPLETED_TEXT)).toBeVisible();
      await expect(page.getByText(NO_AVAILABLE_TEXT)).toBeVisible();
    });
  });
});
