import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'a552c691-c699-48f1-a85d-966fb3794473';
const SECTION_ID = 'c4f5468a-c501-4130-892c-2526abdf6279';
const ASSET_ID = '4da5d513-0b61-4863-b0d3-4c33e1d282d1';
const ASSET_DETAILS_URL = `/studio/project/${PROJECT_UUID}/section/${SECTION_ID}/asset/${ASSET_ID}/details`;
const COURSE_NAME = 'My Asset Project';
const SECTION_NAME = 'Intro Section';
const ASSET_NAME = 'Welcome Asset';

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
      sections: [buildSection(SECTION_ID, SECTION_NAME, [buildAsset(ASSET_ID, ASSET_NAME)])],
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

function buildAssetDetails(overrides: Record<string, any> = {}) {
  return {
    data: {
      uuid: ASSET_ID,
      name: ASSET_NAME,
      order: 1,
      estimated_duration: 0,
      description: 'Asset description',
      type: { uuid: 'asset-type-theory', key: 'theory', type: 'asset-type', order: 1 },
      settings: { ai_delivered: false, visual_assistance: false },
      instructions: null,
      resources: [],
      asset_name_translations: [],
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

async function mockAssetDetails(page: Page, resp = buildAssetDetails()) {
  await page.route(
    `**/o/course/projects/${PROJECT_UUID}/section/${SECTION_ID}/asset/${ASSET_ID}`,
    (route) => {
      if (!isApi(route)) return route.continue();
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(resp),
      });
    }
  );
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

async function setupPage(
  page: Page,
  opts: { details?: any; asset?: any; dict?: any } = {}
) {
  await mockCatchAllApi(page);
  await mockUserProfile(page);
  await mockProjectDictionary(page, opts.dict ?? buildProjectDictionary());
  await mockCourseDetails(page, opts.details ?? buildCourseDetails());
  await mockAssetDetails(page, opts.asset ?? buildAssetDetails());
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const overviewTitle = (page: Page) =>
  page.getByRole('heading', { name: /^overview$/i });

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

test.describe('Studio Web — Asset Details', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(ASSET_DETAILS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the Overview title', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(ASSET_DETAILS_URL);

      await expect(overviewTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders the course name in the breadcrumb', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(ASSET_DETAILS_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders the section name in the breadcrumb', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(ASSET_DETAILS_URL);

      await expect(
        page.getByRole('main').getByText(SECTION_NAME, { exact: true })
      ).toBeVisible({ timeout: 10000 });
    });

    test('renders the asset name in the breadcrumb', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(ASSET_DETAILS_URL);

      await expect(
        page.getByRole('main').getByText(ASSET_NAME, { exact: true }).first()
      ).toBeVisible({ timeout: 10000 });
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

      await page.goto(ASSET_DETAILS_URL);
      await req;
    });

    test('issues GET /o/course/projects/<uuid>/section/<sectionId>/asset/<assetId> on mount', async ({
      page,
    }) => {
      await setupPage(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          new RegExp(
            `/o/course/projects/${PROJECT_UUID}/section/${SECTION_ID}/asset/${ASSET_ID}$`
          ).test(r.url())
      );

      await page.goto(ASSET_DETAILS_URL);
      await req;
    });
  });

  test.describe('Loading state', () => {
    test('does not render the Overview title while course details are still in flight', async ({ page }) => {
      let release: (() => void) | undefined;
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAssetDetails(page);
      await page.route(`**/o/course/projects/${PROJECT_UUID}`, async (route) => {
        if (!isApi(route)) return route.continue();
        if (route.request().method() !== 'GET') return route.continue();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildCourseDetails()),
        });
      });

      await page.goto(ASSET_DETAILS_URL, { waitUntil: 'commit' });
      await expect(overviewTitle(page)).toHaveCount(0, { timeout: 3000 });
      release?.();
    });
  });

  test.describe('Edge cases', () => {
    test('still renders the page chrome when the asset uuid is not found in section assets', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, {
          sections: [
            buildSection(SECTION_ID, SECTION_NAME, [
              buildAsset('other-asset', 'Other Asset'),
            ]),
          ],
        }),
      });
      await page.goto(ASSET_DETAILS_URL);

      await expect(overviewTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('still renders the page chrome when the section uuid is not found', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, {
          sections: [buildSection('other-section', 'Other Section', [])],
        }),
      });
      await page.goto(ASSET_DETAILS_URL);

      await expect(overviewTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('surfaces an error toast when the asset details endpoint fails', async ({ page }, testInfo) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page, buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL));
      await page.route(
        `**/o/course/projects/${PROJECT_UUID}/section/${SECTION_ID}/asset/${ASSET_ID}`,
        (route) => {
          if (!isApi(route)) return route.continue();
          if (route.request().method() !== 'GET') return route.continue();
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'boom' }),
          });
        }
      );

      await page.goto(ASSET_DETAILS_URL);

      await expect(page.getByText(/Request failed with status code 500/i).first()).toBeVisible({
        timeout: 15000,
      });
    });
  });
});
