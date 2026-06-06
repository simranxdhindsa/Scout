import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'project-information-uuid';
const INFORMATION_URL = `/studio/project/${PROJECT_UUID}/information`;
const COURSE_NAME = 'My Information Project';

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

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const objectivesTab = (page: Page) =>
  page.getByRole('tab', { name: /objectives/i });

const prerequisitesTab = (page: Page) =>
  page.getByRole('tab', { name: /prerequisites/i });

const targetAudienceTab = (page: Page) =>
  page.getByRole('tab', { name: /target audience/i });

const skillsTab = (page: Page) =>
  page.getByRole('tab', { name: /skills/i });

const informationTitle = (page: Page) =>
  page.getByRole('heading', { name: /^information$/i });

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

test.describe('Studio Web — Project Information', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(INFORMATION_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the Information page title', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(INFORMATION_URL);

      await expect(informationTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders all four tabs (objectives / prerequisites / target audience / skills)', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(INFORMATION_URL);

      await expect(objectivesTab(page)).toBeVisible({ timeout: 10000 });
      await expect(prerequisitesTab(page)).toBeVisible();
      await expect(targetAudienceTab(page)).toBeVisible();
      await expect(skillsTab(page)).toBeVisible();
    });

    test('defaults to the "objectives" tab when no ?tab is provided', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(INFORMATION_URL);

      await expect(objectivesTab(page)).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    });

    test('selects the "prerequisites" tab when ?tab=prerequisites is provided', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(`${INFORMATION_URL}?tab=prerequisites`);

      await expect(prerequisitesTab(page)).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    });

    test('selects the "target_audience" tab when ?tab=target_audience is provided', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(`${INFORMATION_URL}?tab=target_audience`);

      await expect(targetAudienceTab(page)).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    });

    test('selects the "skills" tab when ?tab=skills is provided', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(`${INFORMATION_URL}?tab=skills`);

      await expect(skillsTab(page)).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    });
  });

  test.describe('Navigation', () => {
    test('clicking the prerequisites tab pushes ?tab=prerequisites to the URL', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(INFORMATION_URL);

      const tab = prerequisitesTab(page);
      await expect(tab).toBeVisible({ timeout: 10000 });
      await tab.click();

      await expect(page).toHaveURL(/[?&]tab=prerequisites\b/, { timeout: 10000 });
    });

    test('clicking the target audience tab pushes ?tab=target_audience to the URL', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(INFORMATION_URL);

      const tab = targetAudienceTab(page);
      await expect(tab).toBeVisible({ timeout: 10000 });
      await tab.click();

      await expect(page).toHaveURL(/[?&]tab=target_audience\b/, { timeout: 10000 });
    });

    test('clicking the skills tab pushes ?tab=skills to the URL', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(INFORMATION_URL);

      const tab = skillsTab(page);
      await expect(tab).toBeVisible({ timeout: 10000 });
      await tab.click();

      await expect(page).toHaveURL(/[?&]tab=skills\b/, { timeout: 10000 });
    });

    test('clicking the objectives tab from a non-default tab restores ?tab=objectives', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(`${INFORMATION_URL}?tab=skills`);

      const tab = objectivesTab(page);
      await expect(tab).toBeVisible({ timeout: 10000 });
      await tab.click();

      await expect(page).toHaveURL(/[?&]tab=objectives\b/, { timeout: 10000 });
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

      await page.goto(INFORMATION_URL);

      await expect(page.getByText(/Request failed with status code 500/i).first()).toBeVisible({
        timeout: 15000,
      });
    });
  });
});
