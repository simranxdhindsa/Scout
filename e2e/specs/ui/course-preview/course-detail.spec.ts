import { test, expect, Page, Route } from '@playwright/test';

/*
 * NOTES
 *
 * Preview mode (`/preview/:courseId`) tests are intentionally skipped — the page's
 * `getServerSideProps` redirects non-studio users to `/403` and also uses a
 * separate `STUDIO_API_URL` for client-side data. Both are out of reach for
 * `page.route()` (it cannot intercept SSR fetches), so we cannot reliably mock
 * the page state. These flows must be covered by a studio-user fixture or by an
 * integration tier with a real studio backend.
 *
 * After a successful `POST /start`, the page navigates to the asset URL. Once
 * mounted, the asset page fires additional API calls; any 404 from those calls
 * triggers a global axios redirect to `/course-not-found`. We pre-stub the
 * `/section/**` sub-paths so the redirect does not fire before our URL assertion.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COURSE_ID = 'course-abc-123';
const SECTION_ID = 'section-001';
const ASSET_ID = 'asset-001';
const LAST_SECTION_ID = 'section-last';
const LAST_ASSET_ID = 'asset-last';
const SIGN_IN_URL = '/auth/signIn';

const courseDetailUrl = (mode: string) => `/${mode}/${COURSE_ID}`;

const isApiRequest = (route: Route) =>
  route.request().resourceType() === 'fetch' || route.request().resourceType() === 'xhr';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
interface CourseDetailOverrides {
  name?: string;
  description?: string;
  objectives?: string | null;
  prerequisites?: string | null;
  skills?: { key: string }[];
  roles?: { key: string }[];
  level?: string;
  started_at?: string | null;
  assignment_id?: string | null;
  course_completed?: boolean;
  first_section_id?: string;
  first_asset_id?: string;
  last_section_id?: string | null;
  last_asset_id?: string | null;
  sections?: any[];
  type?: { key: string };
  audio_model_id?: string | null;
  avatar_id?: string | null;
  estimated_duration?: number | null;
  total_assets?: number;
  completed_assets?: number;
}

function buildCourseDetail(overrides: CourseDetailOverrides = {}) {
  return {
    data: {
      uuid: COURSE_ID,
      name: overrides.name ?? 'Introduction to TypeScript',
      description: overrides.description ?? 'Learn the basics of TypeScript.',
      objectives: overrides.objectives !== undefined ? overrides.objectives : 'Understand types and interfaces.',
      prerequisites: overrides.prerequisites !== undefined ? overrides.prerequisites : null,
      skills: overrides.skills ?? [],
      roles: overrides.roles ?? [],
      level: overrides.level ?? 'Beginner',
      started_at: overrides.started_at !== undefined ? overrides.started_at : null,
      assignment_id: overrides.assignment_id !== undefined ? overrides.assignment_id : null,
      course_completed: overrides.course_completed ?? false,
      first_section_id: overrides.first_section_id ?? SECTION_ID,
      first_asset_id: overrides.first_asset_id ?? ASSET_ID,
      last_section_id: overrides.last_section_id !== undefined ? overrides.last_section_id : null,
      last_asset_id: overrides.last_asset_id !== undefined ? overrides.last_asset_id : null,
      sections: overrides.sections !== undefined ? overrides.sections : [{ uuid: SECTION_ID, name: 'Getting Started' }],
      type: overrides.type ?? { key: 'course' },
      audio_model_id: overrides.audio_model_id !== undefined ? overrides.audio_model_id : null,
      avatar_id: overrides.avatar_id !== undefined ? overrides.avatar_id : null,
      assigned_at: null,
      self_assigned: false,
      estimated_duration: overrides.estimated_duration !== undefined ? overrides.estimated_duration : null,
      teaser: null,
      total_assets: overrides.total_assets ?? 5,
      completed_assets: overrides.completed_assets ?? 0,
      bookmarked: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
//
// Patterns use anchored regexes so they do not overlap:
//   /o/course/{ID}$                  → course detail (GET)
//   /o/course/{ID}/assets            → course assets (GET)
//   /o/course/{ID}/start             → start course (POST)
//   /o/course/{ID}/assignment        → update assignment (PATCH)
//   /o/course/{ID}/section/          → catch-all to prevent /course-not-found cascades
// ---------------------------------------------------------------------------
async function mockCourseDetailApi(page: Page, courseDetail: ReturnType<typeof buildCourseDetail>) {
  await page.route(new RegExp(`/o/course/${COURSE_ID}(?:\\?|$)`), (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(courseDetail),
    });
  });
}

async function mockCourseAssetsApi(page: Page, assets: any[] = []) {
  await page.route(new RegExp(`/o/course/${COURSE_ID}/assets`), (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: assets }),
    });
  });
}

async function mockStartCourseApi(page: Page) {
  await page.route(new RegExp(`/o/course/${COURSE_ID}/start`), (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    });
  });
}

// Prevents the global axios 404 → /course-not-found interceptor from firing when
// the page navigates to the asset URL after a successful Start.
async function stubCourseSubpaths(page: Page) {
  await page.route(new RegExp(`/o/course/${COURSE_ID}/section/`), (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
}

async function setupPage(
  page: Page,
  courseDetail: ReturnType<typeof buildCourseDetail>,
  opts: { mockStart?: boolean; stubSubpaths?: boolean } = {}
) {
  await mockCourseDetailApi(page, courseDetail);
  await mockCourseAssetsApi(page);
  if (opts.mockStart) await mockStartCourseApi(page);
  if (opts.stubSubpaths) await stubCourseSubpaths(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const courseTitle = (page: Page) => page.getByRole('heading', { level: 1 });
const progressBar = (page: Page) => page.locator('.mantine-Progress-root').first();
const objectivesHeading = (page: Page) => page.getByRole('heading', { name: 'Objectives' });
const prerequisitesHeading = (page: Page) => page.getByRole('heading', { name: 'Prerequisites' });
const skillsSidebarHeading = (page: Page) => page.getByRole('heading', { name: 'Skills', level: 4 });
const rolesSidebarHeading = (page: Page) => page.getByRole('heading', { name: 'Roles', level: 4 });
const startBtn = (page: Page) => page.getByRole('button', { name: 'Start Course' });
const resumeBtn = (page: Page) => page.getByRole('button', { name: 'Resume Course' });
const viewBtn = (page: Page) => page.getByRole('button', { name: 'View Course' });
// BookmarkButton ActionIcon carries id="plus-button"
const bookmarkBtn = (page: Page) => page.locator('#plus-button');
const notification = (page: Page) => page.locator('[role="alert"]').first();
const durationText = (page: Page) => page.locator('text=/\\d+\\s*(h|m|min|hr)\\b/i').first();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Course Detail page (/[mode]/[courseId])', () => {
  test.describe('Authentication', () => {
    test('unauthenticated user is redirected to /auth/signIn', async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();
      await page.goto(courseDetailUrl('courses'));
      await expect(page).toHaveURL(new RegExp(SIGN_IN_URL));
      await context.close();
    });
  });

  test.describe('Rendering — courses mode', () => {
    test.beforeEach(async ({ page }) => {
      await setupPage(page, buildCourseDetail());
    });

    test('renders course title', async ({ page }) => {
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(courseTitle(page)).toContainText('Introduction to TypeScript');
    });

    test('progress bar is hidden when course has not been started', async ({ page }) => {
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      // The Flex wrapping the Progress is visibility:hidden when started_at is null
      await expect(progressBar(page).locator('..')).toHaveCSS('visibility', 'hidden');
    });

    test('progress bar is visible after the course has been started', async ({ page }) => {
      await mockCourseDetailApi(page, buildCourseDetail({ started_at: '2024-01-01T00:00:00Z' }));
      await mockCourseAssetsApi(page);
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(progressBar(page).locator('..')).toHaveCSS('visibility', 'visible');
    });

    test('renders description text', async ({ page }) => {
      await page.goto(courseDetailUrl('courses'));
      await expect(page.getByText('Learn the basics of TypeScript.')).toBeVisible({ timeout: 10000 });
    });

    test('renders Objectives section when objectives are present', async ({ page }) => {
      await page.goto(courseDetailUrl('courses'));
      await expect(objectivesHeading(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Understand types and interfaces.')).toBeVisible();
    });

    test('does not render Objectives section when objectives are absent', async ({ page }) => {
      await mockCourseDetailApi(page, buildCourseDetail({ objectives: null }));
      await mockCourseAssetsApi(page);
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(objectivesHeading(page)).toHaveCount(0);
    });

    test('renders Prerequisites section when prerequisites are present', async ({ page }) => {
      await mockCourseDetailApi(page, buildCourseDetail({ prerequisites: 'Basic JavaScript knowledge.' }));
      await mockCourseAssetsApi(page);
      await page.goto(courseDetailUrl('courses'));
      await expect(prerequisitesHeading(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Basic JavaScript knowledge.')).toBeVisible();
    });

    test('does not render Prerequisites section when prerequisites are absent', async ({ page }) => {
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(prerequisitesHeading(page)).toHaveCount(0);
    });

    test('renders skills sidebar when skills are present', async ({ page }) => {
      await mockCourseDetailApi(page, buildCourseDetail({ skills: [{ key: 'React' }, { key: 'TypeScript' }] }));
      await mockCourseAssetsApi(page);
      await page.goto(courseDetailUrl('courses'));
      await expect(skillsSidebarHeading(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('React', { exact: true })).toBeVisible();
    });

    test('renders roles sidebar when roles are present', async ({ page }) => {
      await mockCourseDetailApi(page, buildCourseDetail({ roles: [{ key: 'Frontend Developer' }] }));
      await mockCourseAssetsApi(page);
      await page.goto(courseDetailUrl('courses'));
      await expect(rolesSidebarHeading(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Frontend Developer')).toBeVisible();
    });

    test('renders estimated duration when the course has been started', async ({ page }) => {
      // The duration text is inside the same Flex as the progress bar — both share the
      // started_at visibility gate. Set started_at so the duration is actually visible.
      await mockCourseDetailApi(
        page,
        buildCourseDetail({ estimated_duration: 90, started_at: '2024-01-01T00:00:00Z' })
      );
      await mockCourseAssetsApi(page);
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      // convertToHoursAndMinutes(90) → "1h 30m"
      await expect(durationText(page)).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Action button labels', () => {
    test('shows "Start Course" for a course that has not been started', async ({ page }) => {
      await setupPage(page, buildCourseDetail({ assignment_id: null, started_at: null }));
      await page.goto(courseDetailUrl('courses'));
      await expect(startBtn(page).first()).toBeVisible({ timeout: 10000 });
    });

    test('shows "Resume Course" when the course has an assignment_id', async ({ page }) => {
      await setupPage(
        page,
        buildCourseDetail({ assignment_id: 'assign-001', started_at: '2024-01-01T00:00:00Z' })
      );
      await page.goto(courseDetailUrl('courses'));
      await expect(resumeBtn(page).first()).toBeVisible({ timeout: 10000 });
    });

    test('shows "View Course" when the course is completed', async ({ page }) => {
      await setupPage(
        page,
        buildCourseDetail({
          course_completed: true,
          assignment_id: 'assign-001',
          started_at: '2024-01-01T00:00:00Z',
        })
      );
      await page.goto(courseDetailUrl('courses'));
      await expect(viewBtn(page).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Mode-specific UI', () => {
    // Both MediaQuery wrappers render BookmarkButton, so two #plus-button nodes
    // exist in the DOM at any viewport — one is display:none. We verify the
    // visible one. The complementary preview-mode test (button absent) requires
    // a studio-user fixture (SSR /403 + separate STUDIO_API_URL).
    test('renders the BookmarkButton in courses mode', async ({ page }) => {
      await setupPage(page, buildCourseDetail());
      await page.goto(courseDetailUrl('courses'));
      await expect(courseTitle(page)).toBeVisible({ timeout: 10000 });
      const visibleBookmark = bookmarkBtn(page).locator('visible=true');
      await expect(visibleBookmark).toHaveCount(1, { timeout: 5000 });
    });
  });

  test.describe('Navigation on Start (courses mode)', () => {
    test('shows "This course is empty" notification when there are no sections', async ({ page }) => {
      await setupPage(
        page,
        buildCourseDetail({ sections: [], assignment_id: null }),
        { mockStart: true }
      );
      await page.goto(courseDetailUrl('courses'));
      await expect(startBtn(page).first()).toBeVisible({ timeout: 10000 });
      await startBtn(page).first().click();
      await expect(notification(page)).toBeVisible({ timeout: 5000 });
      await expect(notification(page)).toContainText('This course is empty');
    });

    test('clicking Start posts to /start and navigates to first section/asset', async ({ page }) => {
      await setupPage(
        page,
        buildCourseDetail({ assignment_id: null, started_at: null }),
        { mockStart: true, stubSubpaths: true }
      );
      await page.goto(courseDetailUrl('courses'));
      await expect(startBtn(page).first()).toBeVisible({ timeout: 10000 });

      const startReq = page.waitForRequest(
        (req) => req.url().includes(`/o/course/${COURSE_ID}/start`) && req.method() === 'POST'
      );
      const nav = page.waitForURL(
        new RegExp(`/courses/${COURSE_ID}/section/${SECTION_ID}/asset/${ASSET_ID}`),
        { timeout: 10000 }
      );
      await startBtn(page).first().click();
      await startReq;
      await nav;
    });

    test('Resume navigates to last_section/last_asset when set', async ({ page }) => {
      await setupPage(
        page,
        buildCourseDetail({
          assignment_id: 'assign-001',
          started_at: '2024-01-01T00:00:00Z',
          last_section_id: LAST_SECTION_ID,
          last_asset_id: LAST_ASSET_ID,
        }),
        { stubSubpaths: true }
      );
      await page.goto(courseDetailUrl('courses'));
      await expect(resumeBtn(page).first()).toBeVisible({ timeout: 10000 });

      const nav = page.waitForURL(
        new RegExp(`/courses/${COURSE_ID}/section/${LAST_SECTION_ID}/asset/${LAST_ASSET_ID}`),
        { timeout: 10000 }
      );
      await resumeBtn(page).first().click();
      await nav;
    });

    test('Resume navigates to first section/asset when last_asset_id is null', async ({ page }) => {
      await setupPage(
        page,
        buildCourseDetail({
          assignment_id: 'assign-001',
          started_at: '2024-01-01T00:00:00Z',
          last_section_id: null,
          last_asset_id: null,
        }),
        { stubSubpaths: true }
      );
      await page.goto(courseDetailUrl('courses'));
      await expect(resumeBtn(page).first()).toBeVisible({ timeout: 10000 });

      const nav = page.waitForURL(
        new RegExp(`/courses/${COURSE_ID}/section/${SECTION_ID}/asset/${ASSET_ID}`),
        { timeout: 10000 }
      );
      await resumeBtn(page).first().click();
      await nav;
    });
  });
});
