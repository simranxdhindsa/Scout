import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SKILLS_LAB_DASHBOARD_URL = '/skills-lab/dashboard';

const TRY_ME_TITLE = 'Try Me';
const GUIDE_ME_TITLE = 'Guide Me';
const MENTOR_ME_TITLE = 'Mentor Me';

// All three sub-sections render the same empty-state copy because
// `courses.tsx` hard-codes `common--headings--no-assigned-courses-40-soft`
// regardless of titleKey.
const NO_COURSES_TEXT = 'You do not have any assigned courses yet';

type SubType = 'try-me' | 'guide-me' | 'mentor-me';

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

function buildUserProfile() {
  return { data: { uuid: 'u1', language: 'en', theme: null } };
}

const TRY_ME_A = buildCourseCard({ uuid: 'try-1', name: 'Intro to Prompting' });
const TRY_ME_B = buildCourseCard({ uuid: 'try-2', name: 'Hands-on Python' });
const GUIDE_ME_A = buildCourseCard({ uuid: 'guide-1', name: 'Guided React' });
const MENTOR_ME_A = buildCourseCard({ uuid: 'mentor-1', name: 'Mentor: Architecture' });

// ---------------------------------------------------------------------------
// Mocks
//
// All three carousels hit `${endpoints.generalDashboard}/skills-lab` and are
// distinguished only by the `subType=` query param. The mock helper inspects
// the request URL and returns the matching payload for that subType.
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

async function mockSkillsLabCourses(
  page: Page,
  bySubType: Partial<Record<SubType, CourseCard[]>> = {},
  onCall?: (subType: SubType | null, url: string) => void
) {
  const defaults: Record<SubType, CourseCard[]> = {
    'try-me': [TRY_ME_A, TRY_ME_B],
    'guide-me': [GUIDE_ME_A],
    'mentor-me': [MENTOR_ME_A],
  };

  await page.route(/\/general\/dashboard\/courses\/skills-lab/, (route) => {
    if (!isApi(route)) return route.fallback();
    if (route.request().method() !== 'GET') return route.continue();

    const url = route.request().url();
    const match = url.match(/[?&]subType=([^&]+)/);
    const subType = (match?.[1] as SubType | undefined) ?? null;
    if (onCall) onCall(subType, url);

    const courses =
      subType && subType in defaults
        ? (bySubType[subType] ?? defaults[subType])
        : [];

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCourseListResponse(courses)),
    });
  });
}

// Suggestions/elastic search may fire on the page — keep it silent so the
// dashboard doesn't hit the real network.
async function mockElasticSearch(page: Page) {
  await page.route(/\/elastic|\/search\?/, (route) => {
    if (!isApi(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0, pages: 0, current: 0 } }),
    });
  });
}

async function setupPage(
  page: Page,
  opts: { bySubType?: Partial<Record<SubType, CourseCard[]>> } = {}
) {
  await mockUserProfile(page);
  await mockElasticSearch(page);
  await mockSkillsLabCourses(page, opts.bySubType);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const tryMeTitle = (page: Page) =>
  page.getByRole('heading', { name: TRY_ME_TITLE, exact: true });
const guideMeTitle = (page: Page) =>
  page.getByRole('heading', { name: GUIDE_ME_TITLE, exact: true });
const mentorMeTitle = (page: Page) =>
  page.getByRole('heading', { name: MENTOR_ME_TITLE, exact: true });

// Scope arrow-button assertions to a single carousel.
const sectionByTitle = (page: Page, title: string) =>
  page
    .locator(
      `xpath=//*[self::h1 or self::h2 or self::h3 or self::h4][normalize-space()=${JSON.stringify(title)}]/ancestor::*[contains(@class,'mantine-Stack-root')][1]`
    )
    .first();

const searchIconButton = (page: Page) =>
  page.locator('xpath=//*[contains(@class,"tabler-icon")][@onmouseenter] | //*[name()="svg" and @onmouseenter]').first();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Skills Lab — Dashboard', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(SKILLS_LAB_DASHBOARD_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders all three section titles (Try Me / Guide Me / Mentor Me)', async ({ page }) => {
      await setupPage(page);
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(guideMeTitle(page)).toBeVisible();
      await expect(mentorMeTitle(page)).toBeVisible();
    });

    test('renders course cards returned for each subType', async ({ page }) => {
      await setupPage(page);
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });

      await expect(page.getByText(TRY_ME_A.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(TRY_ME_B.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(GUIDE_ME_A.name, { exact: false }).first()).toBeVisible();
      await expect(page.getByText(MENTOR_ME_A.name, { exact: false }).first()).toBeVisible();
    });

    test('renders the dashboard search affordance', async ({ page }) => {
      await setupPage(page);
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });
      // SearchForm in dashboard mode renders a <form> containing the collapsed search icon.
      await expect(page.locator('form').first()).toBeVisible();
    });
  });

  test.describe('Empty states', () => {
    test('shows empty message for Try Me when API returns no courses', async ({ page }) => {
      await setupPage(page, { bySubType: { 'try-me': [] } });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      const section = sectionByTitle(page, TRY_ME_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });
      await expect(section.getByText(NO_COURSES_TEXT)).toBeVisible();
    });

    test('shows empty message for Guide Me when API returns no courses', async ({ page }) => {
      await setupPage(page, { bySubType: { 'guide-me': [] } });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      const section = sectionByTitle(page, GUIDE_ME_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });
      await expect(section.getByText(NO_COURSES_TEXT)).toBeVisible();
    });

    test('shows empty message for Mentor Me when API returns no courses', async ({ page }) => {
      await setupPage(page, { bySubType: { 'mentor-me': [] } });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      const section = sectionByTitle(page, MENTOR_ME_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });
      await expect(section.getByText(NO_COURSES_TEXT)).toBeVisible();
    });

    test('all three sections render empty messages when every subType returns []', async ({ page }) => {
      await setupPage(page, {
        bySubType: { 'try-me': [], 'guide-me': [], 'mentor-me': [] },
      });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(NO_COURSES_TEXT)).toHaveCount(3);
    });
  });

  test.describe('Network', () => {
    test('fires three GET /skills-lab requests, one per subType', async ({ page }) => {
      const seen = new Set<string>();
      await mockUserProfile(page);
      await mockElasticSearch(page);
      await mockSkillsLabCourses(page, {}, (subType) => {
        if (subType) seen.add(subType);
      });

      await page.goto(SKILLS_LAB_DASHBOARD_URL);
      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });

      await expect.poll(() => seen.size, { timeout: 10000 }).toBe(3);
      expect(seen).toEqual(new Set(['try-me', 'guide-me', 'mentor-me']));
    });

    test('GET /skills-lab forwards size=10 and page=0', async ({ page }) => {
      await mockUserProfile(page);
      await mockElasticSearch(page);
      await mockSkillsLabCourses(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/general\/dashboard\/courses\/skills-lab\?/.test(r.url()) &&
          r.url().includes('size=10') &&
          r.url().includes('page=0')
      );

      await page.goto(SKILLS_LAB_DASHBOARD_URL);
      await req;
    });
  });

  test.describe('Interaction', () => {
    test('Try Me carousel: prev disabled / next enabled on initial render', async ({ page }) => {
      const many = Array.from({ length: 6 }, (_, i) =>
        buildCourseCard({ uuid: `try-${i}`, name: `Try Me Course ${i}` })
      );
      await setupPage(page, { bySubType: { 'try-me': many } });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      const section = sectionByTitle(page, TRY_ME_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });

      const buttons = section.locator('button');
      await expect(buttons.nth(0)).toBeDisabled();
      await expect(buttons.nth(1)).toBeEnabled();
    });

    test('Try Me carousel: clicking next then prev re-disables prev', async ({ page }) => {
      const many = Array.from({ length: 6 }, (_, i) =>
        buildCourseCard({ uuid: `try-${i}`, name: `Try Me Course ${i}` })
      );
      await setupPage(page, { bySubType: { 'try-me': many } });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      const section = sectionByTitle(page, TRY_ME_TITLE);
      await expect(section).toBeVisible({ timeout: 10000 });

      const buttons = section.locator('button');
      await buttons.nth(1).click();
      await expect(buttons.nth(0)).toBeEnabled();

      await buttons.nth(0).click();
      await expect(buttons.nth(0)).toBeDisabled();
    });

    test('hides carousel arrows when a section has no courses', async ({ page }) => {
      await setupPage(page, { bySubType: { 'try-me': [] } });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      const section = sectionByTitle(page, TRY_ME_TITLE);
      await expect(section.getByText(NO_COURSES_TEXT)).toBeVisible({ timeout: 10000 });
      await expect(section.locator('button')).toHaveCount(0);
    });
  });

  test.describe('Navigation', () => {
    test('search form submission navigates to /search with the typed query', async ({ page }) => {
      await setupPage(page);
      await page.goto(SKILLS_LAB_DASHBOARD_URL);
      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });

      // Hover the collapsed search icon to reveal the input.
      const searchIcon = page.locator('svg').filter({ hasText: '' }).first();
      // The TextInput placeholder comes from `search-page--header--search-courses`.
      // Force it into view by hovering the icon container — if not visible, dispatch hover on the icon node.
      const form = page.locator('form').first();
      await form.hover();

      const input = page.getByPlaceholder(/search/i).first();
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill('react');
      await input.press('Enter');

      await expect(page).toHaveURL(/\/search\?.*query=react/, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('renders titles + empty messages when every subType is empty', async ({ page }) => {
      await setupPage(page, {
        bySubType: { 'try-me': [], 'guide-me': [], 'mentor-me': [] },
      });
      await page.goto(SKILLS_LAB_DASHBOARD_URL);

      await expect(tryMeTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(guideMeTitle(page)).toBeVisible();
      await expect(mentorMeTitle(page)).toBeVisible();
      await expect(page.getByText(NO_COURSES_TEXT)).toHaveCount(3);
    });
  });
});
