import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const USER_ATTRS_URL = '/administration/user-attributes';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildAdminProfile() {
  return { data: { uuid: 'u1', admin: true, language: 'en' } };
}

function buildAttribute(i: number) {
  // attributes-list.tsx renders settings.display, settings.attribute, and
  // settings.mandatory — match that shape exactly.
  return {
    uuid: `attr-${i}`,
    display: `Display ${i}`,
    attribute: `attribute_${i}`,
    mandatory: i % 2 === 0,
  };
}

function buildAttributesResponse(count = 3, total = 3) {
  return {
    data: Array.from({ length: count }, (_, i) => buildAttribute(i + 1)),
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

async function mockAttributesList(page: Page, resp = buildAttributesResponse()) {
  await page.route('**/settings/user-attributes**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockDeleteAttribute(page: Page, onCall?: (id: string) => void) {
  await page.route('**/settings/user-attributes/**', (route) => {
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
  await mockAttributesList(page, opts.list ?? buildAttributesResponse());
  await mockDeleteAttribute(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Administration — User Attributes', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(USER_ATTRS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders attribute rows from the API', async ({ page }) => {
      await setupPage(page);
      await page.goto(USER_ATTRS_URL);

      await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
      // attributes-list.tsx renders <td>{display}</td><td>{attribute}</td><td>{mandatory ? 'Yes' : 'No'}</td>
      await expect(page.getByRole('cell', { name: 'Display 1', exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'attribute_1', exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Display 2', exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'attribute_2', exact: true })).toBeVisible();
    });

    test('renders empty state when no attributes exist', async ({ page }) => {
      await setupPage(page, { list: { data: [], meta: { total: 0, page: 0, size: 10 } } });
      await page.goto(USER_ATTRS_URL);

      await expect(page.getByRole('cell', { name: 'attribute_1' })).toHaveCount(0, {
        timeout: 10000,
      });
    });
  });

  test.describe('Pagination params', () => {
    test('GET /settings/user-attributes forwards page/size/query from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockAttributesList(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/settings\/user-attributes\?/.test(r.url()) &&
          r.url().includes('size=20') &&
          r.url().includes('page=2') &&
          r.url().includes('query=dept')
      );

      await page.goto(`${USER_ATTRS_URL}?page=3&size=20&query=dept`);
      await req;
    });
  });
});
