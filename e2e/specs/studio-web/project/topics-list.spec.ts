import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_UUID = 'project-topics-uuid';
const TOPICS_URL = `/studio/project/${PROJECT_UUID}/topics-list`;
const COURSE_NAME = 'My Topics';

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

function buildTopic(i: number, overrides: Record<string, any> = {}) {
  return {
    uuid: `topic-${i}`,
    topic: `Topic ${i}`,
    explanation: `Explanation for topic ${i}`,
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

function buildCourseDetailsWithTopics(count = 3, baseURL?: string) {
  const subdomain = baseURL?.match(/https?:\/\/([^./]+)\./)?.[1] ?? 'match';
  return buildCourseDetails({
    owner: { uuid: 'owner-uuid', name: 'Match Org', domain: subdomain, ardoise_id: 'ardoise-id' },
    topics: Array.from({ length: count }, (_, i) => buildTopic(i + 1)),
  });
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

async function mockAddTopic(page: Page, onCall?: (body: any) => void) {
  await page.route(`**/o/course/projects/${PROJECT_UUID}/topics`, (route) => {
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
      body: JSON.stringify({ data: { uuid: 'topic-new', topic: 'new', explanation: '' } }),
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
  await mockAddTopic(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const topicsTitle = (page: Page) =>
  page.getByRole('heading', { name: /^topics$/i });

const addTopicButton = (page: Page) =>
  page.getByRole('button', { name: /add topic/i });

const saveButton = (page: Page) =>
  page.getByRole('button', { name: /^save$/i });

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

test.describe('Studio Web — Project Topics', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(TOPICS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the course name in the breadcrumb', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(TOPICS_URL);

      await expect(page.getByText(COURSE_NAME, { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders the Topics title', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL),
      });
      await page.goto(TOPICS_URL);

      await expect(topicsTitle(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders each topic returned by the API', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsWithTopics(3, testInfo.project.use.baseURL),
      });
      await page.goto(TOPICS_URL);

      // Allow for the 1-second client-side render delay
      await expect(page.getByText('Topic 1', { exact: true })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Topic 2', { exact: true })).toBeVisible();
      await expect(page.getByText('Topic 3', { exact: true })).toBeVisible();
    });

    test('auto-opens the AddTopic form when the project has no topics', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, { topics: [] }),
      });
      await page.goto(TOPICS_URL);

      // The Save button only appears inside the AddTopic form
      await expect(saveButton(page)).toBeVisible({ timeout: 15000 });
    });

    test('does not auto-open the AddTopic form when topics exist', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsWithTopics(2, testInfo.project.use.baseURL),
      });
      await page.goto(TOPICS_URL);

      await expect(page.getByText('Topic 1', { exact: true })).toBeVisible({ timeout: 15000 });
      // Save button (form-bound) should not be visible until user opens form
      await expect(saveButton(page)).toHaveCount(0);
    });
  });

  test.describe('API requests', () => {
    test('issues GET /o/course/projects/<uuid> on mount', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page);
      await mockAddTopic(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          new RegExp(`/o/course/projects/${PROJECT_UUID}$`).test(r.url())
      );

      await page.goto(TOPICS_URL);
      await req;
    });
  });

  test.describe('Interaction', () => {
    test('clicking "Add Topic" opens the AddTopic form when topics already exist', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsWithTopics(2, testInfo.project.use.baseURL),
      });
      await page.goto(TOPICS_URL);

      const addBtn = addTopicButton(page);
      await expect(addBtn).toBeVisible({ timeout: 15000 });
      await addBtn.click();

      await expect(saveButton(page)).toBeVisible({ timeout: 5000 });
    });

    test('saving a new topic triggers POST /o/course/projects/<uuid>/topics with the entered topic', async ({
      page,
    }, testInfo) => {
      let postedBody: any = null;
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockCourseDetails(page, buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, { topics: [] }));
      await mockAddTopic(page, (body) => {
        postedBody = body;
      });

      await page.goto(TOPICS_URL);

      const topicInput = page.getByRole('textbox').first();
      await expect(topicInput).toBeVisible({ timeout: 15000 });
      await topicInput.fill('Brand new topic');

      const save = saveButton(page);
      await expect(save).toBeEnabled({ timeout: 5000 });

      const [request] = await Promise.all([
        page.waitForRequest(
          (r) =>
            r.method() === 'POST' &&
            new RegExp(`/o/course/projects/${PROJECT_UUID}/topics$`).test(r.url())
        ),
        save.click(),
      ]);

      expect(request.method()).toBe('POST');
      expect(postedBody?.topic).toBe('Brand new topic');
    });

    test('blocks submission when topic input is empty (Save disabled)', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetailsForCurrentDomain(testInfo.project.use.baseURL, { topics: [] }),
      });
      await page.goto(TOPICS_URL);

      const save = saveButton(page);
      await expect(save).toBeVisible({ timeout: 15000 });
      await expect(save).toBeDisabled();
    });
  });

  test.describe('Edge cases', () => {
    test('surfaces an error toast when course details endpoint fails', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAddTopic(page);
      await page.route(`**/o/course/projects/${PROJECT_UUID}`, (route) => {
        if (!isApi(route)) return route.continue();
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(TOPICS_URL);

      await expect(page.getByText(/Request failed with status code 500/i).first()).toBeVisible({
        timeout: 15000,
      });
    });

    test('renders a single topic when API returns one item', async ({ page }, testInfo) => {
      await setupPage(page, {
        details: buildCourseDetails({
          owner: {
            domain:
              testInfo.project.use.baseURL?.match(/https?:\/\/([^./]+)\./)?.[1] ?? 'match',
          },
          topics: [buildTopic(99, { topic: 'Solo Topic' })],
        }),
      });
      await page.goto(TOPICS_URL);

      await expect(page.getByText('Solo Topic', { exact: true })).toBeVisible({ timeout: 15000 });
    });
  });
});
