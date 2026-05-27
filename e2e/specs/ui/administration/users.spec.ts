import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const USERS_URL = '/administration/users';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildAdminProfile(admin = true) {
  return {
    data: {
      uuid: 'user-uuid-1',
      first_name: 'Admin',
      last_name: 'User',
      email: 'admin@example.com',
      admin,
      theme: 'dark',
      learning_mode_preference: 'avatar',
      language: 'en',
    },
  };
}

function buildUser(i: number) {
  return {
    uuid: `user-${i}`,
    user_id: `user-${i}`,
    first_name: `First${i}`,
    last_name: `Last${i}`,
    email: `user${i}@example.com`,
    language: 'EN',
  };
}

function buildUsersListResponse(count = 3, total = 3) {
  return {
    data: Array.from({ length: count }, (_, i) => buildUser(i + 1)),
    meta: { total, page: 0, size: 10 },
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
function isApi(route: Route): boolean {
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

async function mockUsersList(
  page: Page,
  resp: ReturnType<typeof buildUsersListResponse> = buildUsersListResponse()
) {
  await page.route('**/manage/users**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    if (/\/manage\/users\/import/.test(route.request().url())) return route.continue();
    if (/\/manage\/users\/options/.test(route.request().url())) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function setupPage(page: Page, opts: { admin?: boolean; list?: any } = {}) {
  await mockUserProfile(page, opts.admin ?? true);
  await mockUsersList(page, opts.list ?? buildUsersListResponse());
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const pageTitle = (page: Page) =>
  page.getByRole('heading', { level: 2 }).first();

const userRow = (page: Page, firstName: string) =>
  page.locator('tr', { hasText: firstName });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Administration — Users', () => {
  test.describe('Authentication & Authorization', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(USERS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });

    test('redirects non-admin users to /404', async ({ page }) => {
      await setupPage(page, { admin: false });
      await page.goto(USERS_URL);
      await expect(page).toHaveURL(/\/404/, { timeout: 10000 });
    });
  });

  test.describe('Rendering', () => {
    test('renders the page title and users table with rows', async ({ page }) => {
      await setupPage(page);
      await page.goto(USERS_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(userRow(page, 'First1')).toBeVisible();
      await expect(userRow(page, 'First2')).toBeVisible();
      await expect(userRow(page, 'First3')).toBeVisible();
    });

    test('shows empty-state when API returns no users', async ({ page }) => {
      await setupPage(page, { list: { data: [], meta: { total: 0, page: 0, size: 10 } } });
      await page.goto(USERS_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.locator('table tbody tr')).toHaveCount(0);
    });

    test('first-name cell links to /administration/users/<id>', async ({ page }) => {
      await setupPage(page);
      await page.goto(USERS_URL);

      const link = page.getByRole('link', { name: 'First1' });
      await expect(link).toBeVisible({ timeout: 10000 });
      await expect(link).toHaveAttribute('href', /\/administration\/users\/user-1/);
    });
  });

  test.describe('Pagination', () => {
    test('GET request includes the query-string params from the URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockUsersList(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/manage\/users\?/.test(r.url()) &&
          r.url().includes('size=25') &&
          r.url().includes('page=1')
      );

      await page.goto(`${USERS_URL}?page=2&size=25&query=jane`);
      await req;
    });
  });
});
