import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'project-section-create-uuid';
const SECTION_CREATE_URL = `/studio/project/${PROJECT_UUID}/section/create`;
const COURSE_NAME = 'My SC Project';
const NEW_SECTION_UUID = 'newly-created-section';

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

function buildCreateSectionResponse(uuid = NEW_SECTION_UUID, name = 'New Section') {
  return { data: { uuid, name } };
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

async function mockCreateSection(
  page: Page,
  resp = buildCreateSectionResponse(),
  onCall?: (body: any) => void
) {
  await page.route(`**/o/course/projects/${PROJECT_UUID}/section`, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'POST') return route.continue();
    if (onCall) {
      try {
        onCall(JSON.parse(route.request().postData() || '{}'));
      } catch {
        onCall({});
      }
    }
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
  await mockCreateSection(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const saveButton = (page: Page) =>
  page.getByRole('button', { name: /^save$/i });

const cancelButton = (page: Page) =>
  page.getByRole('button', { name: /^cancel$/i });

const sectionNameInput = (page: Page) => page.getByRole('textbox').first();

// The page-level title key is `project--section--creating-section-50-hard`
// — typically rendered as "Creating Section". Match flexibly.
const creatingSectionTitle = (page: Page) =>
  page.getByRole('heading', { name: /creating section/i });

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

test.describe('Studio Web — Section Create', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(SECTION_CREATE_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the "Creating Section" title', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(SECTION_CREATE_URL);

      await expect(creatingSectionTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders the course name in the breadcrumb', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(SECTION_CREATE_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders the section-name input plus Save and Cancel buttons', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(SECTION_CREATE_URL);

      await expect(sectionNameInput(page)).toBeVisible({ timeout: 10000 });
      await expect(saveButton(page)).toBeVisible();
      await expect(cancelButton(page)).toBeVisible();
    });

    test('disables the Save button while the section-name input is empty', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(SECTION_CREATE_URL);

      await expect(saveButton(page)).toBeDisabled({ timeout: 10000 });
    });

    test('enables the Save button once the section name has been typed', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(SECTION_CREATE_URL);

      await sectionNameInput(page).fill('A new section');
      await expect(saveButton(page)).toBeEnabled({ timeout: 10000 });
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

      await page.goto(SECTION_CREATE_URL);
      await req;
    });
  });

  test.describe('Create', () => {
    test('saving triggers POST /o/course/projects/<uuid>/section with the entered name', async ({
      page,
    }, testInfo) => {
      let postedBody: any = null;
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page, buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL));
      await mockCreateSection(page, buildCreateSectionResponse(), (body) => {
        postedBody = body;
      });

      await page.goto(SECTION_CREATE_URL);

      await sectionNameInput(page).fill('Brand new section');
      const save = saveButton(page);
      await expect(save).toBeEnabled({ timeout: 10000 });

      const [request] = await Promise.all([
        page.waitForRequest(
          (r) =>
            r.method() === 'POST' &&
            new RegExp(`/o/course/projects/${PROJECT_UUID}/section$`).test(r.url())
        ),
        save.click(),
      ]);

      expect(request.method()).toBe('POST');
      expect(postedBody?.name).toBe('Brand new section');
    });

    test('redirects to /project/<uuid>/section/<newSectionId> after a successful create', async ({
      page,
    }, testInfo) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page, buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL));
      await mockCreateSection(page, buildCreateSectionResponse(NEW_SECTION_UUID, 'New Section'));

      await page.goto(SECTION_CREATE_URL);
      await sectionNameInput(page).fill('Brand new section');
      await saveButton(page).click();

      await expect(page).toHaveURL(
        new RegExp(`/project/${PROJECT_UUID}/section/${NEW_SECTION_UUID}`),
        { timeout: 10000 }
      );
    });
  });

  test.describe('Navigation', () => {
    test('clicking Cancel navigates to /project/<uuid>/outline', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(SECTION_CREATE_URL);

      const cancel = cancelButton(page);
      await expect(cancel).toBeVisible({ timeout: 10000 });
      await cancel.click();

      await expect(page).toHaveURL(new RegExp(`/project/${PROJECT_UUID}/outline`), {
        timeout: 10000,
      });
    });
  });

  test.describe('Edge cases', () => {
    test('surfaces an error toast when course details endpoint fails', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCreateSection(page);
      await page.route(`**/o/course/projects/${PROJECT_UUID}`, (route) => {
        if (!isApi(route)) return route.continue();
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(SECTION_CREATE_URL);

      await expect(page.getByText(/Request failed with status code 500/i).first()).toBeVisible({
        timeout: 15000,
      });
    });
  });
});
