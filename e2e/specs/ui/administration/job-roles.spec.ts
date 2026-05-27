import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const JOB_ROLES_URL = '/administration/job-roles';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildAdminProfile() {
  return { data: { uuid: 'u1', admin: true, language: 'en' } };
}

function buildRole(i: number) {
  return { uuid: `role-${i}`, key: `Role ${i}` };
}

function buildRolesResponse(count = 3, total = 3) {
  return {
    data: Array.from({ length: count }, (_, i) => buildRole(i + 1)),
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

async function mockUserProfile(page: Page) {
  await page.route('**/user/profile**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAdminProfile()),
    });
  });
}

async function mockRolesList(page: Page, resp = buildRolesResponse()) {
  await page.route('**/settings/roles**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockDeleteRole(page: Page, onCall?: (id: string) => void) {
  await page.route('**/settings/roles/**', (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const id = route.request().url().split('/').pop()?.split('?')[0] || '';
    if (onCall) onCall(id);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    });
  });
}

async function setupPage(page: Page, opts: { list?: any } = {}) {
  await mockUserProfile(page);
  await mockRolesList(page, opts.list ?? buildRolesResponse());
  await mockDeleteRole(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Administration — Job Roles', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(JOB_ROLES_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders job roles returned by the API as table rows', async ({ page }) => {
      await setupPage(page);
      await page.goto(JOB_ROLES_URL);

      await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('cell', { name: 'Role 1', exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Role 2', exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Role 3', exact: true })).toBeVisible();
    });

    test('renders empty state when no roles exist', async ({ page }) => {
      await setupPage(page, { list: { data: [], meta: { total: 0, page: 0, size: 10 } } });
      await page.goto(JOB_ROLES_URL);

      await expect(page.getByRole('cell', { name: 'Role 1' })).toHaveCount(0, { timeout: 10000 });
    });
  });

  test.describe('Pagination params', () => {
    test('GET /settings/roles forwards page/size/query from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockRolesList(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/settings\/roles\?/.test(r.url()) &&
          r.url().includes('size=25') &&
          r.url().includes('page=1') &&
          r.url().includes('query=engineer')
      );

      await page.goto(`${JOB_ROLES_URL}?page=2&size=25&query=engineer`);
      await req;
    });
  });

  test.describe('Delete', () => {
    test('confirming the delete modal triggers DELETE /settings/roles/<id>', async ({ page }) => {
      let deletedId = '';
      await mockUserProfile(page);
      await mockRolesList(page);
      await mockDeleteRole(page, (id) => {
        deletedId = id;
      });

      await page.goto(JOB_ROLES_URL);

      await expect(page.getByRole('cell', { name: 'Role 1', exact: true })).toBeVisible({
        timeout: 10000,
      });

      const firstRow = page.locator('table tbody tr').first();
      await firstRow.locator('button').last().click();

      const confirm = page.getByRole('button', { name: /^confirm$/i });
      await expect(confirm).toBeVisible({ timeout: 5000 });

      const [request] = await Promise.all([
        page.waitForRequest(
          (r) => r.method() === 'DELETE' && /\/settings\/roles\//.test(r.url())
        ),
        confirm.click(),
      ]);

      expect(request.method()).toBe('DELETE');
      expect(deletedId).toBe('role-1');
    });
  });
});
