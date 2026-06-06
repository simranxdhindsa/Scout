import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'project-outline-uuid';
const OUTLINE_URL = `/studio/project/${PROJECT_UUID}/outline`;
const COURSE_NAME = 'My Outline';

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

function buildAsset(uuid: string, name: string, overrides: Record<string, any> = {}) {
  return {
    uuid,
    name,
    order: 1,
    estimated_duration: 0,
    description: '',
    type: { uuid: 'asset-type-theory', key: 'theory', type: 'asset-type', order: 1 },
    settings: { ai_delivered: false, visual_assistance: false },
    instructions: null,
    resources: [],
    asset_name_translations: [],
    ...overrides,
  };
}

function buildSection(uuid: string, name: string, assets: any[] = [], overrides: Record<string, any> = {}) {
  return {
    uuid,
    name,
    order: 1,
    application: null,
    section_name_translations: [],
    assets,
    ...overrides,
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
      sections: [
        buildSection('section-1', 'First Section', [buildAsset('asset-1a', 'Asset 1A')]),
        buildSection('section-2', 'Second Section', []),
        buildSection('section-3', 'Third Section', [
          buildAsset('asset-3a', 'Asset 3A'),
          buildAsset('asset-3b', 'Asset 3B'),
        ]),
      ],
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

function buildCourseDetailsForCurrentDomain(baseURL?: string, overrides: Record<string, any> = {}) {
  const subdomain = baseURL?.match(/https?:\/\/([^./]+)\./)?.[1] ?? 'match';
  return buildCourseDetails({
    owner: { uuid: 'owner-uuid', name: 'Match Org', domain: subdomain, ardoise_id: 'ardoise-id' },
    ...overrides,
  });
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

async function mockDeleteSection(page: Page, onCall?: (uuid: string, sectionId: string) => void) {
  await page.route(`**/o/course/projects/${PROJECT_UUID}/section/*`, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'DELETE') return route.continue();
    const sectionId = route.request().url().split('/').pop()?.split('?')[0] || '';
    if (onCall) onCall(PROJECT_UUID, sectionId);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
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
  await mockDeleteSection(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const sectionsTitle = (page: Page) =>
  page.getByRole('heading', { name: /^sections$/i });

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

test.describe('Studio Web — Project Outline', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(OUTLINE_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the Sections title', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(OUTLINE_URL);

      await expect(sectionsTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders the course name in the breadcrumb', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(OUTLINE_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders each section returned by the API', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(OUTLINE_URL);

      const main = page.getByRole('main');
      await expect(main.getByText('First Section', { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(main.getByText('Second Section', { exact: true })).toBeVisible();
      await expect(main.getByText('Third Section', { exact: true })).toBeVisible();
    });

    test('renders an empty sections list when the project has no sections', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, { sections: [] }),
      });
      await page.goto(OUTLINE_URL);

      await expect(sectionsTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('First Section', { exact: true })).toHaveCount(0);
    });

    test('hides assets initially (section is collapsed by default)', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(OUTLINE_URL);

      const main = page.getByRole('main');
      // Section names render, but assets sit inside a collapsed container
      await expect(main.getByText('First Section', { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(main.getByText('Asset 1A', { exact: true })).not.toBeVisible();
    });
  });

  test.describe('API requests', () => {
    test('issues GET /o/course/projects/<uuid> on mount', async ({ page }) => {
      await setupPage(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          new RegExp(`/o/course/projects/${PROJECT_UUID}$`).test(r.url())
      );

      await page.goto(OUTLINE_URL);
      await req;
    });
  });

  test.describe('Interaction', () => {
    test('clicking the section header expands the assets list', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(OUTLINE_URL);

      const main = page.getByRole('main');
      const firstSection = main.getByText('First Section', { exact: true });
      await expect(firstSection).toBeVisible({ timeout: 10000 });
      await firstSection.click();

      await expect(main.getByText('Asset 1A', { exact: true })).toBeVisible({ timeout: 5000 });
    });

    test('clicking an expanded section header collapses it again', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(OUTLINE_URL);

      const main = page.getByRole('main');
      const firstSection = main.getByText('First Section', { exact: true });
      await expect(firstSection).toBeVisible({ timeout: 10000 });

      await firstSection.click();
      await expect(main.getByText('Asset 1A', { exact: true })).toBeVisible({ timeout: 5000 });

      await firstSection.click();
      await expect(main.getByText('Asset 1A', { exact: true })).not.toBeVisible();
    });
  });

  test.describe('Edge cases', () => {
    test('surfaces an error toast when course details endpoint fails', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockDeleteSection(page);
      await page.route(`**/o/course/projects/${PROJECT_UUID}`, (route) => {
        if (!isApi(route)) return route.continue();
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(OUTLINE_URL);

      await expect(page.getByText(/Request failed with status code 500/i).first()).toBeVisible({
        timeout: 15000,
      });
    });

    test('renders a single section when API returns one item', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, {
          sections: [buildSection('section-only', 'Solo Section', [])],
        }),
      });
      await page.goto(OUTLINE_URL);

      await expect(page.getByText('Solo Section', { exact: true })).toBeVisible({ timeout: 10000 });
    });
  });
});
