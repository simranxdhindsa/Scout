import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'project-context-uuid';
const CONTEXT_URL = `/studio/project/${PROJECT_UUID}/context`;
const COURSE_NAME = 'My Context';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserProfile() {
  return { data: { uuid: 'u1', admin: true, language: 'en' } };
}

function buildProjectDictionary() {
  return {
    data: {
      languages: [{ key: 'en' }, { key: 'fr' }],
      status_types: [{ key: 'draft' }, { key: 'published' }],
    },
  };
}

function buildCourseDetails(overrides: Record<string, any> = {}) {
  return {
    data: {
      uuid: PROJECT_UUID,
      name: COURSE_NAME,
      // owner.domain must match the BASE_URL subdomain for useCourseDisabled
      // to leave isActionDisabled = false. Tests that need that use
      // buildCourseDetailsForCurrentDomain.
      owner: { uuid: 'owner-uuid', name: 'Match Org', domain: 'match', ardoise_id: 'ardoise-id' },
      mode: { uuid: 'mode-manual', key: 'manual', type: 'project-mode', order: 1 },
      status: { uuid: 'status-draft', key: 'draft', type: 'status', order: 1 },
      under_review: false,
      title: COURSE_NAME,
      description: 'A project description',
      objectives: '',
      target_audience: '',
      prerequisites: '',
      type: { uuid: 'type-course', key: 'course', type: 'course-type', order: 1 },
      project_language: { uuid: 'lang-en', key: 'EN', type: 'asset-languages-type', order: 1 },
      additional_languages: [],
      level: 'beginner',
      teaser: '',
      created_by: { uuid: 'cb1', first_name: 'Test', last_name: 'User', email: 't@example.com', creator: true },
      updated_by: { uuid: 'cb1', first_name: 'Test', last_name: 'User', email: 't@example.com' },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      scorm_scrapped: false,
      setup_complete: true,
      setup_incomplete_for: [],
      source_project_id: null,
      source_org: null,
      published_course_id: null,
      knowledge_bases: [],
      kb_slots: [],
      topics: [],
      sections: [],
      skills: [],
      roles: [],
      description_translations: [],
      objective_translations: [],
      target_audience_translation: [],
      prerequisites_translations: [],
      project_title_translation: [],
      ...overrides,
    },
  };
}

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

async function mockProjectDictionary(page: Page, resp = buildProjectDictionary()) {
  await page.route('**/o/course/projects/options**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockCourseDetails(page: Page, resp = buildCourseDetails()) {
  // Match the exact /<uuid> endpoint, not /<uuid>/anything-else
  await page.route(`**/o/course/projects/${PROJECT_UUID}`, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockCatchAllApi(page: Page) {
  await page.route('**/o/**', (route) => {
    if (!isApi(route)) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { current: 0, items: 0, number: 0, pages: 0, size: 10 } }),
    });
  });
}

async function setupPage(page: Page, opts: { details?: any; dict?: any } = {}) {
  await mockCatchAllApi(page);
  await mockUserProfile(page);
  await mockProjectDictionary(page, opts.dict ?? buildProjectDictionary());
  await mockCourseDetails(page, opts.details ?? buildCourseDetails());
}

// Helper: set owner.domain to whatever subdomain the BASE_URL is on,
// so `isActionDisabled` evaluates to false in tests that expect tabs.
function buildCourseDetailsForCurrentDomain(baseURL?: string, overrides: Record<string, any> = {}) {
  const subdomain = baseURL?.match(/https?:\/\/([^./]+)\./)?.[1] ?? 'match';
  return buildCourseDetails({
    owner: { uuid: 'owner-uuid', name: 'Match Org', domain: subdomain, ardoise_id: 'ardoise-id' },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const projectContextTab = (page: Page) =>
  page.getByRole('tab', { name: /project context/i });

const orgContextTab = (page: Page) =>
  page.getByRole('tab', { name: /org context/i });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) return;
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    { name: 'userSelectedLanguage', value: 'en', domain: hostname, path: '/' },
  ]);
});

test.describe('Studio Web — Project Context', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(CONTEXT_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the course name in the breadcrumb', async ({ page }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      await setupPage(page, { details: buildCourseDetailsForCurrentDomain(baseURL) });
      await page.goto(CONTEXT_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders both context tabs when the user owns the project', async ({ page }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      await setupPage(page, { details: buildCourseDetailsForCurrentDomain(baseURL) });
      await page.goto(CONTEXT_URL);

      await expect(projectContextTab(page)).toBeVisible({ timeout: 10000 });
      await expect(orgContextTab(page)).toBeVisible();
    });

    test('defaults to the "project-context" tab when no ?tab is provided', async ({ page }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      await setupPage(page, { details: buildCourseDetailsForCurrentDomain(baseURL) });
      await page.goto(CONTEXT_URL);

      await expect(projectContextTab(page)).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    });

    test('selects the "org-context" tab when ?tab=org-context is provided', async ({ page }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      await setupPage(page, { details: buildCourseDetailsForCurrentDomain(baseURL) });
      await page.goto(`${CONTEXT_URL}?tab=org-context`);

      await expect(orgContextTab(page)).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    });

    test('hides tabs and renders the knowledge bases title when the project is owned by another domain', async ({
      page,
    }) => {
      await setupPage(page, {
        details: buildCourseDetails({ owner: { domain: 'someone-else' } }),
      });
      await page.goto(CONTEXT_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(projectContextTab(page)).toHaveCount(0);
      await expect(orgContextTab(page)).toHaveCount(0);
    });
  });

  test.describe('API requests', () => {
    test('issues GET /o/course/projects/<uuid> on mount', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page);
      await mockCatchAllApi(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          new RegExp(`/o/course/projects/${PROJECT_UUID}$`).test(r.url())
      );

      await page.goto(CONTEXT_URL);
      await req;
    });
  });

  test.describe('Navigation', () => {
    test('clicking the org-context tab pushes ?tab=org-context to the URL', async ({ page }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      await setupPage(page, { details: buildCourseDetailsForCurrentDomain(baseURL) });
      await page.goto(CONTEXT_URL);

      const tab = orgContextTab(page);
      await expect(tab).toBeVisible({ timeout: 10000 });

      await tab.click();

      await expect(page).toHaveURL(/[?&]tab=org-context\b/, { timeout: 10000 });
    });

    test('clicking the project-context tab from org-context restores ?tab=project-context', async ({ page }, testInfo) => {
      const baseURL = testInfo.project.use.baseURL;
      await setupPage(page, { details: buildCourseDetailsForCurrentDomain(baseURL) });
      await page.goto(`${CONTEXT_URL}?tab=org-context`);

      const tab = projectContextTab(page);
      await expect(tab).toBeVisible({ timeout: 10000 });

      await tab.click();

      await expect(page).toHaveURL(/[?&]tab=project-context\b/, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('surfaces an error toast when course details endpoint fails', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await page.route(`**/o/course/projects/${PROJECT_UUID}`, (route) => {
        if (!isApi(route)) return route.continue();
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(CONTEXT_URL);

      await expect(page.getByText(/Request failed with status code 500/i).first()).toBeVisible({
        timeout: 15000,
      });
    });
  });
});
