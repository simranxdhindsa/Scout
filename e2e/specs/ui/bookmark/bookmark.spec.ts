import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BOOKMARK_URL = '/bookmark';

const PAGE_TITLE = 'Bookmark Courses';
const EMPTY_TEXT = 'No Data Found';

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

interface BookmarkEntry {
  uuid: string;
  course: CourseCard;
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

function buildBookmark(course: CourseCard): BookmarkEntry {
  return { uuid: `bm-${course.uuid}`, course };
}

function buildBookmarkListResponse(
  bookmarks: BookmarkEntry[],
  meta: { current?: number; pages?: number; total?: number; size?: number } = {}
) {
  return {
    data: bookmarks,
    meta: {
      current: meta.current ?? 0,
      pages: meta.pages ?? 1,
      total: meta.total ?? bookmarks.length,
      size: meta.size ?? 10,
    },
  };
}

function buildUserProfile() {
  return { data: { uuid: 'u1', language: 'en', theme: null } };
}

const COURSE_A = buildCourseCard({ uuid: 'course-1', name: 'React Fundamentals' });
const COURSE_B = buildCourseCard({ uuid: 'course-2', name: 'Advanced Node.js' });
const COURSE_C = buildCourseCard({ uuid: 'course-3', name: 'Docker for Beginners' });

const BOOKMARK_A = buildBookmark(COURSE_A);
const BOOKMARK_B = buildBookmark(COURSE_B);
const BOOKMARK_C = buildBookmark(COURSE_C);

// ---------------------------------------------------------------------------
// Mocks
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

async function mockBookmarksList(
  page: Page,
  resp = buildBookmarkListResponse([BOOKMARK_A, BOOKMARK_B, BOOKMARK_C]),
  onCall?: (url: string) => void
) {
  await page.route('**/user/bookmarks**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    if (onCall) onCall(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function setupPage(
  page: Page,
  opts: {
    list?: ReturnType<typeof buildBookmarkListResponse>;
  } = {}
) {
  await mockUserProfile(page);
  await mockBookmarksList(page, opts.list);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const pageTitle = (page: Page) =>
  page.getByRole('heading', { name: PAGE_TITLE, exact: true });

// Pagination "Page X of Y" label — text comes from the
// `pagination--general--page-number-30-soft` translation.
const paginationLabel = (page: Page, current: number, total: number) =>
  page.getByText(`Page ${current} of ${total}`, { exact: true });

const pageSizeMenuTrigger = (page: Page, size: number) =>
  page.getByText(`Show ${size} Rows`, { exact: true });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Bookmark — Courses', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(BOOKMARK_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the page title', async ({ page }) => {
      await setupPage(page);
      await page.goto(BOOKMARK_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders bookmarked course cards returned by the API', async ({ page }) => {
      await setupPage(page);
      await page.goto(BOOKMARK_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });

      await expect(page.getByText(COURSE_A.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(COURSE_B.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(COURSE_C.name, { exact: false }).first()).toBeVisible();
    });

    test('renders the empty state when no bookmarks exist', async ({ page }) => {
      await setupPage(page, { list: buildBookmarkListResponse([], { pages: 0, total: 0 }) });
      await page.goto(BOOKMARK_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
    });

    test('does not render pagination when there are no bookmarks', async ({ page }) => {
      await setupPage(page, { list: buildBookmarkListResponse([], { pages: 0, total: 0 }) });
      await page.goto(BOOKMARK_URL);

      await expect(page.getByText(EMPTY_TEXT)).toBeVisible({ timeout: 10000 });
      // PaginationComponent returns null when meta.pages is falsy.
      await expect(page.getByText(/^Page \d+ of \d+$/)).toHaveCount(0);
    });

    test('renders pagination when there is more than one page', async ({ page }) => {
      await setupPage(page, {
        list: buildBookmarkListResponse([BOOKMARK_A, BOOKMARK_B], {
          current: 0,
          pages: 3,
          total: 25,
          size: 10,
        }),
      });
      await page.goto(BOOKMARK_URL);

      await expect(paginationLabel(page, 1, 3)).toBeVisible({ timeout: 10000 });
      await expect(pageSizeMenuTrigger(page, 10)).toBeVisible();
    });
  });

  test.describe('Network', () => {
    test('GET /user/bookmarks defaults to size=10 and page=0', async ({ page }) => {
      await mockUserProfile(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/user\/bookmarks\?/.test(r.url()) &&
          r.url().includes('size=10') &&
          r.url().includes('page=0')
      );

      await mockBookmarksList(page);
      await page.goto(BOOKMARK_URL);
      await req;
    });

    test('GET /user/bookmarks forwards page/size from URL (page=2 → page=1, size=25)', async ({ page }) => {
      await mockUserProfile(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/user\/bookmarks\?/.test(r.url()) &&
          r.url().includes('size=25') &&
          r.url().includes('page=1')
      );

      await mockBookmarksList(page);
      await page.goto(`${BOOKMARK_URL}?page=2&size=25`);
      await req;
    });
  });

  test.describe('Pagination — Interaction', () => {
    test('clicking next navigates to /bookmark?page=2&size=10', async ({ page }) => {
      await setupPage(page, {
        list: buildBookmarkListResponse([BOOKMARK_A, BOOKMARK_B], {
          current: 0,
          pages: 3,
          total: 25,
          size: 10,
        }),
      });
      await page.goto(BOOKMARK_URL);

      await expect(paginationLabel(page, 1, 3)).toBeVisible({ timeout: 10000 });

      // Pagination renders prev + next ActionIcons around the page label;
      // the last button in the group is the "next" chevron.
      const paginationGroup = paginationLabel(page, 1, 3).locator('xpath=ancestor::*[contains(@class,"mantine-Group-root")][1]');
      await paginationGroup.locator('button').last().click();

      await expect(page).toHaveURL(/\/bookmark\?page=2&size=10/, { timeout: 10000 });
    });

    test('next button is disabled when activePage === meta.pages', async ({ page }) => {
      await setupPage(page, {
        list: buildBookmarkListResponse([BOOKMARK_A], {
          current: 2,
          pages: 3,
          total: 25,
          size: 10,
        }),
      });
      await page.goto(`${BOOKMARK_URL}?page=3&size=10`);

      await expect(paginationLabel(page, 3, 3)).toBeVisible({ timeout: 10000 });

      const paginationGroup = paginationLabel(page, 3, 3).locator('xpath=ancestor::*[contains(@class,"mantine-Group-root")][1]');
      await expect(paginationGroup.locator('button').last()).toBeDisabled();
    });

    test('prev button is disabled on page 1', async ({ page }) => {
      await setupPage(page, {
        list: buildBookmarkListResponse([BOOKMARK_A, BOOKMARK_B], {
          current: 0,
          pages: 3,
          total: 25,
          size: 10,
        }),
      });
      await page.goto(BOOKMARK_URL);

      await expect(paginationLabel(page, 1, 3)).toBeVisible({ timeout: 10000 });

      const paginationGroup = paginationLabel(page, 1, 3).locator('xpath=ancestor::*[contains(@class,"mantine-Group-root")][1]');
      await expect(paginationGroup.locator('button').first()).toBeDisabled();
    });

    test('choosing a new page size from the dropdown navigates to page=1 with the new size', async ({ page }) => {
      await setupPage(page, {
        list: buildBookmarkListResponse([BOOKMARK_A, BOOKMARK_B], {
          current: 1,
          pages: 5,
          total: 100,
          size: 10,
        }),
      });
      await page.goto(`${BOOKMARK_URL}?page=2&size=10`);

      await expect(pageSizeMenuTrigger(page, 10)).toBeVisible({ timeout: 10000 });
      await pageSizeMenuTrigger(page, 10).click();

      // Page-size menu items are unlabeled buttons containing only the number.
      await page.getByRole('menuitem', { name: '20', exact: true }).click();

      await expect(page).toHaveURL(/\/bookmark\?page=1&size=20/, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('renders title + empty state when the API returns an unexpected payload', async ({ page }) => {
      await setupPage(page, {
        list: { data: [], meta: { current: 0, pages: 0, total: 0, size: 10 } } as any,
      });
      await page.goto(BOOKMARK_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
    });

    test('renders cards even when only one bookmark exists', async ({ page }) => {
      await setupPage(page, {
        list: buildBookmarkListResponse([BOOKMARK_A], { pages: 1, total: 1 }),
      });
      await page.goto(BOOKMARK_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(COURSE_A.name, { exact: false }).first()).toBeVisible();
    });
  });
});
