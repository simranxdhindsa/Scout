import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SHARED_PROJECTS_URL = '/studio/shared-projects';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserProfile() {
  return { data: { uuid: 'u1', admin: true, language: 'en' } };
}

function buildCourse(i: number, overrides: Record<string, any> = {}) {
  return {
    id: i,
    uuid: `shared-course-${i}`,
    name: `Shared Course ${i}`,
    description: `Description for shared course ${i}`,
    notes: '',
    teaser: '',
    status: { key: 'draft' },
    ...overrides,
  };
}

function buildAuthorizedProjectsResponse(count = 3, items = count, current = 0, size = 10) {
  // Real backend pagination shape — see jobs spec for field semantics.
  return {
    data: Array.from({ length: count }, (_, i) => buildCourse(i + 1)),
    meta: {
      current,
      items,
      number: count,
      pages: Math.max(1, Math.ceil(items / size)),
      size,
    },
  };
}

function buildProjectDictionary() {
  return {
    data: {
      status_types: [
        { key: 'draft' },
        { key: 'published' },
        { key: 'archived' },
      ],
      languages: [{ key: 'en' }, { key: 'fr' }, { key: 'de' }],
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

async function mockAuthorizedProjects(page: Page, resp = buildAuthorizedProjectsResponse()) {
  await page.route(/\/o\/course\/projects\/authorized\?/, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function setupPage(page: Page, opts: { list?: any; dict?: any } = {}) {
  // Catch-all first so specific mocks (registered later) win — Playwright
  // matches routes in reverse-registration order.
  await mockCatchAllApi(page);
  await mockUserProfile(page);
  await mockProjectDictionary(page, opts.dict ?? buildProjectDictionary());
  await mockAuthorizedProjects(page, opts.list ?? buildAuthorizedProjectsResponse());
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const searchInput = (page: Page) =>
  page.getByPlaceholder(/search by name/i);

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

test.describe('Studio Web — Shared Projects List', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(SHARED_PROJECTS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders each shared course returned by the API', async ({ page }) => {
      await setupPage(page);
      await page.goto(SHARED_PROJECTS_URL);

      await expect(page.getByText('Shared Course 1', { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Shared Course 2', { exact: true })).toBeVisible();
      await expect(page.getByText('Shared Course 3', { exact: true })).toBeVisible();
    });

    test('renders the search input once data has loaded', async ({ page }) => {
      await setupPage(page);
      await page.goto(SHARED_PROJECTS_URL);

      await expect(searchInput(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders empty state when no shared projects exist', async ({ page }) => {
      await setupPage(page, {
        list: { data: [], meta: { current: 0, items: 0, number: 0, pages: 0, size: 10 } },
      });
      await page.goto(SHARED_PROJECTS_URL);

      await expect(page.getByText('Shared Course 1', { exact: true })).toHaveCount(0, { timeout: 10000 });
    });
  });

  test.describe('Pagination params', () => {
    test('GET /o/course/projects/authorized forwards page/size from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAuthorizedProjects(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/course\/projects\/authorized\?/.test(r.url()) &&
          r.url().includes('size=25') &&
          // Component subtracts 1 from the page query param before sending
          r.url().includes('page=1')
      );

      await page.goto(`${SHARED_PROJECTS_URL}?page=2&size=25`);
      await req;
    });

    test('GET /o/course/projects/authorized forwards query (search) from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAuthorizedProjects(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/course\/projects\/authorized\?/.test(r.url()) &&
          r.url().includes('query=onboarding')
      );

      await page.goto(`${SHARED_PROJECTS_URL}?page=1&size=10&query=onboarding`);
      await req;
    });

    test('GET /o/course/projects/authorized forwards status filter when not "all"', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAuthorizedProjects(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/course\/projects\/authorized\?/.test(r.url()) &&
          r.url().includes('status=published')
      );

      await page.goto(`${SHARED_PROJECTS_URL}?page=1&size=10&status=published`);
      await req;
    });

    test('GET /o/course/projects/authorized omits status when set to "all"', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAuthorizedProjects(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/course\/projects\/authorized\?/.test(r.url()) &&
          !/[?&]status=/.test(r.url())
      );

      await page.goto(`${SHARED_PROJECTS_URL}?page=1&size=10&status=all`);
      await req;
    });

    test('GET /o/course/projects/authorized forwards courseTypes when provided', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockAuthorizedProjects(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/course\/projects\/authorized\?/.test(r.url()) &&
          /[?&]courseTypes=/.test(r.url())
      );

      await page.goto(`${SHARED_PROJECTS_URL}?page=1&size=10&courseTypes=COURSE`);
      await req;
    });
  });

  test.describe('Interaction', () => {
    test('typing in the search input and pressing Enter pushes ?query= to the URL', async ({ page }) => {
      await setupPage(page);
      await page.goto(SHARED_PROJECTS_URL);

      const input = searchInput(page);
      await expect(input).toBeVisible({ timeout: 10000 });

      await input.fill('onboarding');
      await input.press('Enter');

      await expect(page).toHaveURL(/[?&]query=onboarding\b/, { timeout: 10000 });
    });

    test('clearing the search input drops ?query= from the URL', async ({ page }) => {
      await setupPage(page);
      await page.goto(`${SHARED_PROJECTS_URL}?page=1&size=10&query=onboarding`);

      const input = searchInput(page);
      await expect(input).toBeVisible({ timeout: 10000 });
      await expect(input).toHaveValue('onboarding');

      await input.fill('');

      await expect(page).not.toHaveURL(/[?&]query=onboarding\b/, { timeout: 10000 });
    });
  });

  test.describe('Edge cases', () => {
    test('renders courses even when project dictionary call fails', async ({ page }) => {
      await mockUserProfile(page);
      await mockAuthorizedProjects(page);
      await page.route('**/o/course/projects/options**', (route) => {
        if (!isApi(route)) return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(SHARED_PROJECTS_URL);

      await expect(page.getByText('Shared Course 1', { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders a single shared course when API returns one item', async ({ page }) => {
      await setupPage(page, {
        list: {
          data: [buildCourse(99, { name: 'Solo Shared Course' })],
          meta: { current: 0, items: 1, number: 1, pages: 1, size: 10 },
        },
      });
      await page.goto(SHARED_PROJECTS_URL);

      await expect(page.getByText('Solo Shared Course', { exact: true })).toBeVisible({ timeout: 10000 });
    });
  });
});
