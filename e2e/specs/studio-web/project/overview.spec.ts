import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'project-overview-uuid';
const OVERVIEW_URL = `/studio/project/${PROJECT_UUID}/overview`;
const COURSE_NAME = 'My Test Project';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserProfile() {
  return { data: { uuid: 'u1', admin: true, language: 'en' } };
}

function buildProjectDictionary() {
  return {
    data: {
      languages: [{ key: 'en' }, { key: 'fr' }, { key: 'de' }],
      status_types: [{ key: 'draft' }, { key: 'published' }],
    },
  };
}

function buildCourseDetails(overrides: Record<string, any> = {}) {
  return {
    data: {
      uuid: PROJECT_UUID,
      name: COURSE_NAME,
      owner: { uuid: 'owner-uuid', name: 'Match Org', domain: 'match', ardoise_id: 'ardoise-id' },
      mode: { uuid: 'mode-manual', key: 'manual', type: 'project-mode', order: 1 },
      status: { uuid: 'status-draft', key: 'draft', type: 'status', order: 1 },
      under_review: false,
      title: COURSE_NAME,
      description: 'A project description',
      objectives: '',
      target_audience: '',
      prerequisites: '',
      notes: '',
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

function buildTranslateStatus(status: 'COMPLETE' | 'PROCESSING' | 'PENDING' = 'COMPLETE') {
  return {
    data: {
      status,
      languages: status === 'PROCESSING' ? ['fr', 'de'] : [],
      section_count: 0,
      asset_count: 0,
      description: 'Translations queued',
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

async function mockTranslateStatus(page: Page, resp = buildTranslateStatus()) {
  await page.route(`**/o/course/projects/${PROJECT_UUID}/translate/status`, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

// Catch-all: any other API request the page (or its sub-components) makes
// is fulfilled with an empty 200 so the page can render. Specific mocks
// registered before this take priority.
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

async function setupPage(
  page: Page,
  opts: { details?: any; translate?: any; dict?: any } = {}
) {
  await mockCatchAllApi(page);
  await mockUserProfile(page);
  await mockProjectDictionary(page, opts.dict ?? buildProjectDictionary());
  await mockCourseDetails(page, opts.details ?? buildCourseDetails());
  await mockTranslateStatus(page, opts.translate ?? buildTranslateStatus());
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const nextButton = (page: Page) =>
  page.getByRole('button', { name: /^next$/i });

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

test.describe('Studio Web — Project Overview', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(OVERVIEW_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the course name in the breadcrumb', async ({ page }) => {
      await setupPage(page);
      await page.goto(OVERVIEW_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true }).first()).toBeVisible({ timeout: 10000 });
    });

    test('renders the "Next" button to navigate to the context step', async ({ page }) => {
      await setupPage(page);
      await page.goto(OVERVIEW_URL);

      await expect(nextButton(page)).toBeVisible({ timeout: 10000 });
    });

    test('does not render the translation alert when status is COMPLETE', async ({ page }) => {
      await setupPage(page, { translate: buildTranslateStatus('COMPLETE') });
      await page.goto(OVERVIEW_URL);

      await expect(nextButton(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    });

    test('renders the translation alert when status is PROCESSING', async ({ page }) => {
      await setupPage(page, { translate: buildTranslateStatus('PROCESSING') });
      await page.goto(OVERVIEW_URL);

      await expect(page.getByRole('main').getByRole('alert').first()).toBeVisible({ timeout: 10000 });
    });

    test('renders the translation alert when status is PENDING', async ({ page }) => {
      await setupPage(page, { translate: buildTranslateStatus('PENDING') });
      await page.goto(OVERVIEW_URL);

      await expect(page.getByRole('main').getByRole('alert').first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('API requests', () => {
    test('issues GET /o/course/projects/<uuid> on mount', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page);
      await mockTranslateStatus(page);
      await mockCatchAllApi(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          new RegExp(`/o/course/projects/${PROJECT_UUID}$`).test(r.url())
      );

      await page.goto(OVERVIEW_URL);
      await req;
    });

    test('issues GET /o/course/projects/<uuid>/translate/status on mount', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page);
      await mockTranslateStatus(page);
      await mockCatchAllApi(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          new RegExp(`/o/course/projects/${PROJECT_UUID}/translate/status$`).test(r.url())
      );

      await page.goto(OVERVIEW_URL);
      await req;
    });
  });

  test.describe('Navigation', () => {
    test('clicking "Next" navigates to /project/<uuid>/context', async ({ page }) => {
      await setupPage(page);
      await page.goto(OVERVIEW_URL);

      const btn = nextButton(page);
      await expect(btn).toBeVisible({ timeout: 10000 });

      await btn.click();
      await expect(page).toHaveURL(new RegExp(`/project/${PROJECT_UUID}/context`), {
        timeout: 10000,
      });
    });
  });

  test.describe('Edge cases', () => {
    test('renders the page when course details has empty setup_incomplete_for', async ({ page }) => {
      await setupPage(page, {
        details: buildCourseDetails({ setup_incomplete_for: [] }),
      });
      await page.goto(OVERVIEW_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true }).first()).toBeVisible({ timeout: 10000 });
    });

    test('renders incomplete-setup warning when setup_incomplete_for has items', async ({ page }) => {
      await setupPage(page, {
        details: buildCourseDetails({
          setup_incomplete_for: [{ key: 'objectives' }, { key: 'prerequisites' }],
        }),
      });
      await page.goto(OVERVIEW_URL);

      // Course name still renders alongside the warning
      await expect(page.getByText(COURSE_NAME, { exact: true }).first()).toBeVisible({ timeout: 10000 });
    });

    test('keeps the page usable when translate-status endpoint fails', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page);
      await page.route(`**/o/course/projects/${PROJECT_UUID}/translate/status`, (route) => {
        if (!isApi(route)) return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(OVERVIEW_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await expect(nextButton(page)).toBeVisible();
    });
  });
});
