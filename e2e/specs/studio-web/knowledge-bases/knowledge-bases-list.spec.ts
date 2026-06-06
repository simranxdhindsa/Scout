import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KB_URL = '/studio/knowledge-bases';

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

function buildKb(i: number, overrides: Record<string, any> = {}) {
  return {
    uuid: `kb-${i}`,
    external_id: `ext-${i}`,
    name: `KB ${i}`,
    description: `Description ${i}`,
    ...overrides,
  };
}

function buildKbsResponse(count = 3, items = count, current = 0, size = 10) {
  // Real backend pagination shape: { current, items, number, pages, size }.
  return {
    data: Array.from({ length: count }, (_, i) => buildKb(i + 1)),
    meta: {
      current,
      items,
      number: count,
      pages: Math.max(1, Math.ceil(items / size)),
      size,
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

async function mockKbList(
  page: Page,
  resp = buildKbsResponse(),
  onCall?: (url: string) => void
) {
  await page.route(/\/o\/org\/knowledge-bases\/manage(\?|$)/, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    if (onCall) onCall(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockCreateKb(
  page: Page,
  resp: any = { data: { uuid: 'kb-new', name: 'New KB', description: '' } },
  onCall?: (body: any) => void
) {
  await page.route('**/o/org/knowledge-bases/manage', (route) => {
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

async function mockDeleteKb(
  page: Page,
  onCall?: (id: string, force: boolean) => void,
  status = 200,
  body: any = { data: { success: true } }
) {
  await page.route('**/o/org/knowledge-bases/manage/**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'DELETE') return route.continue();
    if (onCall) {
      const url = new URL(route.request().url());
      // pathname ends with the id; strip query string + trailing slash defensively.
      const id = url.pathname.replace(/\/$/, '').split('/').pop() ?? '';
      const force = url.searchParams.get('force') === 'true';
      onCall(id, force);
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function setupPage(
  page: Page,
  opts: { list?: any; dict?: any } = {}
) {
  await mockCatchAllApi(page);
  await mockUserProfile(page);
  await mockProjectDictionary(page, opts.dict ?? buildProjectDictionary());
  await mockKbList(page, opts.list ?? buildKbsResponse());
  await mockCreateKb(page);
  await mockDeleteKb(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const pageTitle = (page: Page) =>
  page.getByRole('heading', { name: /^knowledge bases$/i });

const addKbTrigger = (page: Page) =>
  page.getByRole('button', { name: /^knowledge base$/i });

const addKbModalSaveButton = (page: Page) =>
  page.getByRole('button', { name: /^save$/i });

const confirmButton = (page: Page) =>
  page.getByRole('button', { name: /^confirm$/i });

const cancelButton = (page: Page) =>
  page.getByRole('button', { name: /^cancel$/i });

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

test.describe('Studio Web — Knowledge Bases List', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(KB_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders the page title and each KB returned by the API', async ({ page }) => {
      await setupPage(page);
      await page.goto(KB_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('KB 1', { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('KB 2', { exact: true })).toBeVisible();
      await expect(page.getByText('KB 3', { exact: true })).toBeVisible();
    });

    test('renders an Add Knowledge Base button next to the title', async ({ page }) => {
      await setupPage(page);
      await page.goto(KB_URL);

      await expect(addKbTrigger(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders empty state when no KBs exist', async ({ page }) => {
      await setupPage(page, { list: buildKbsResponse(0) });
      await page.goto(KB_URL);

      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('KB 1', { exact: true })).toHaveCount(0);
    });
  });

  test.describe('Pagination params', () => {
    test('GET /o/org/knowledge-bases/manage forwards page/size from URL', async ({ page }) => {
      let capturedUrl = '';
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockKbList(page, buildKbsResponse(2), (url) => {
        capturedUrl = url;
      });
      await mockCreateKb(page);
      await mockDeleteKb(page);

      await page.goto(`${KB_URL}?query=&page=2&size=20`);
      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });

      // The feature converts page → 0-based by subtracting 1.
      expect(capturedUrl).toMatch(/[?&]page=1\b/);
      expect(capturedUrl).toMatch(/[?&]size=20\b/);
    });

    test('GET /o/org/knowledge-bases/manage forwards query from URL', async ({ page }) => {
      let capturedUrl = '';
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockKbList(page, buildKbsResponse(2), (url) => {
        capturedUrl = url;
      });
      await mockCreateKb(page);
      await mockDeleteKb(page);

      await page.goto(`${KB_URL}?query=needle&page=1&size=10`);
      await expect(pageTitle(page)).toBeVisible({ timeout: 10000 });

      expect(capturedUrl).toMatch(/[?&]query=needle\b/);
    });
  });

  test.describe('Add KB', () => {
    test('clicking Add Knowledge Base opens the modal', async ({ page }) => {
      await setupPage(page);
      await page.goto(KB_URL);

      await expect(addKbTrigger(page)).toBeVisible({ timeout: 10000 });
      await addKbTrigger(page).click();

      await expect(page.getByRole('heading', { name: /add knowledge base/i })).toBeVisible({
        timeout: 5000,
      });
      await expect(addKbModalSaveButton(page)).toBeVisible();
    });
  });

  test.describe('Delete', () => {
    test('confirming the delete modal triggers DELETE /o/org/knowledge-bases/manage/<id>', async ({
      page,
    }) => {
      let calledId = '';
      let calledForce = false;
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockKbList(page);
      await mockCreateKb(page);
      await mockDeleteKb(page, (id, force) => {
        calledId = id;
        calledForce = force;
      });

      await page.goto(KB_URL);
      await expect(page.getByText('KB 1', { exact: true })).toBeVisible({ timeout: 10000 });

      // The KB list renders one ActionIcon (delete) per row. Click the first.
      const firstRow = page.getByRole('row').filter({ hasText: 'KB 1' });
      await firstRow.locator('button').first().click();

      const confirm = confirmButton(page);
      await expect(confirm).toBeVisible({ timeout: 5000 });

      const [request] = await Promise.all([
        page.waitForRequest(
          (r) =>
            r.method() === 'DELETE' &&
            /\/o\/org\/knowledge-bases\/manage\/[^/?]+/.test(r.url())
        ),
        confirm.click(),
      ]);

      expect(request.method()).toBe('DELETE');
      // The non-force delete path is the default; force=true only fires after
      // the in-use confirmation.
      expect(calledForce).toBe(false);
      expect(calledId).toBe('kb-1');
    });

    test('cancel button closes the delete modal without firing a DELETE request', async ({
      page,
    }) => {
      let deleteCalled = false;
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockKbList(page);
      await mockCreateKb(page);
      await mockDeleteKb(page, () => {
        deleteCalled = true;
      });

      await page.goto(KB_URL);
      await expect(page.getByText('KB 1', { exact: true })).toBeVisible({ timeout: 10000 });

      const firstRow = page.getByRole('row').filter({ hasText: 'KB 1' });
      await firstRow.locator('button').first().click();

      const cancel = cancelButton(page);
      await expect(cancel).toBeVisible({ timeout: 5000 });
      await cancel.click();

      await expect(cancel).toHaveCount(0, { timeout: 5000 });
      expect(deleteCalled).toBe(false);
    });
  });

  test.describe('Edge cases', () => {
    test('renders KBs even when project dictionary call fails', async ({ page }) => {
      await mockCatchAllApi(page);
      await mockUserProfile(page);
      await page.route('**/o/course/projects/options**', (route) => {
        if (!isApi(route)) return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });
      await mockKbList(page);
      await mockCreateKb(page);
      await mockDeleteKb(page);

      await page.goto(KB_URL);

      await expect(page.getByText('KB 1', { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders a single KB when API returns one item', async ({ page }) => {
      await setupPage(page, {
        list: {
          data: [buildKb(99, { name: 'Solo KB' })],
          meta: { current: 0, items: 1, number: 1, pages: 1, size: 10 },
        },
      });
      await page.goto(KB_URL);

      await expect(page.getByText('Solo KB', { exact: true })).toBeVisible({ timeout: 10000 });
    });
  });
});
