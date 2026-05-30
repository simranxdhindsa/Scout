import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TEAMS_URL = '/administration/teams';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildAdminProfile(admin = true) {
  return {
    data: { uuid: 'u1', first_name: 'Admin', last_name: 'User', email: 'a@b.com', admin, language: 'en' },
  };
}

function buildTeam(i: number) {
  return {
    uuid: `team-${i}`,
    name: `Team ${i}`,
    description: `Description ${i}`,
    members_count: i * 2,
  };
}

function buildTeamsResponse(count = 3, total = 3) {
  return {
    data: Array.from({ length: count }, (_, i) => buildTeam(i + 1)),
    meta: { total, page: 0, size: 10 },
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
function isApi(route: Route) {
  const t = route.request().resourceType();
  return t === 'fetch' || t === 'xhr';
}

async function mockUserProfile(page: Page, admin = true) {
  await page.route('**/user/profile**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAdminProfile(admin)),
    });
  });
}

async function mockTeamsList(page: Page, resp = buildTeamsResponse()) {
  await page.route('**/manage/team**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function setupPage(page: Page, opts: { admin?: boolean; list?: any } = {}) {
  await mockUserProfile(page, opts.admin ?? true);
  await mockTeamsList(page, opts.list ?? buildTeamsResponse());
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const searchInput = (page: Page) => page.getByPlaceholder('Search Teams');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Administration — Teams', () => {
  test.describe('Authentication & Authorization', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(TEAMS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });

    test('redirects non-admin users to /404', async ({ page }) => {
      await setupPage(page, { admin: false });
      await page.goto(TEAMS_URL);
      await expect(page).toHaveURL(/\/404/, { timeout: 10000 });
    });
  });

  test.describe('Rendering', () => {
    test('renders page title and team rows from API', async ({ page }) => {
      await setupPage(page);
      await page.goto(TEAMS_URL);

      await expect(page.getByRole('heading', { name: /teams/i, level: 1 })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText('Team 1', { exact: false })).toBeVisible();
      await expect(page.getByText('Team 2', { exact: false })).toBeVisible();
      await expect(page.getByText('Team 3', { exact: false })).toBeVisible();
    });

    test('renders empty state when API returns no teams', async ({ page }) => {
      await setupPage(page, { list: { data: [], meta: { total: 0, page: 0, size: 10 } } });
      await page.goto(TEAMS_URL);

      await expect(searchInput(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Team 1')).toHaveCount(0);
    });

    test('renders the search input', async ({ page }) => {
      await setupPage(page);
      await page.goto(TEAMS_URL);
      await expect(searchInput(page)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Search', () => {
    test('typing in the search input pushes ?query=... after 300ms debounce', async ({ page }) => {
      await setupPage(page);
      await page.goto(TEAMS_URL);

      await expect(searchInput(page)).toBeVisible({ timeout: 10000 });
      await searchInput(page).fill('design');

      await expect(page).toHaveURL(/[?&]query=design/, { timeout: 5000 });
      await expect(page).toHaveURL(/[?&]page=1/);
    });
  });

  test.describe('Pagination params', () => {
    test('GET /manage/team forwards page/size/query from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockTeamsList(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/manage\/team\?/.test(r.url()) &&
          r.url().includes('size=25') &&
          r.url().includes('page=2') &&
          r.url().includes('query=marketing')
      );

      await page.goto(`${TEAMS_URL}?page=3&size=25&query=marketing`);
      await req;
    });
  });
});
