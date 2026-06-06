import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SKILLS_URL = '/studio/skills';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserProfile() {
  return { data: { uuid: 'u1', admin: true, language: 'en' } };
}

function buildSkill(i: number, overrides: Record<string, any> = {}) {
  return {
    uuid: `skill-${i}`,
    key: `Skill ${i}`,
    translations: [],
    ...overrides,
  };
}

function buildSkillsResponse(count = 3, items = count, current = 0, size = 10) {
  // Real backend pagination shape — see jobs spec for field semantics.
  return {
    data: Array.from({ length: count }, (_, i) => buildSkill(i + 1)),
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
      languages: [
        { key: 'en' },
        { key: 'fr' },
        { key: 'de' },
      ],
      status_types: [{ key: 'draft' }, { key: 'published' }],
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

async function mockSkillsList(page: Page, resp = buildSkillsResponse()) {
  await page.route(/\/o\/skills\?/, (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockSyncGlobalSkills(page: Page, onCall?: () => void) {
  await page.route('**/o/skills/sync-global', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'POST') return route.continue();
    if (onCall) onCall();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    });
  });
}

async function mockDeleteSkill(page: Page, onCall?: (id: string) => void) {
  await page.route('**/o/skills/**', (route) => {
    if (!isApi(route)) return route.continue();
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

async function mockUpdateSkill(page: Page, onCall?: (id: string, body: any) => void) {
  await page.route('**/o/skills/**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'PATCH') return route.continue();
    const id = route.request().url().split('/').pop()?.split('?')[0] || '';
    if (onCall) {
      try {
        onCall(id, JSON.parse(route.request().postData() || '{}'));
      } catch {
        onCall(id, {});
      }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { uuid: id } }),
    });
  });
}

async function setupPage(page: Page, opts: { list?: any; dict?: any } = {}) {
  await mockCatchAllApi(page);
  await mockUserProfile(page);
  await mockProjectDictionary(page, opts.dict ?? buildProjectDictionary());
  await mockSkillsList(page, opts.list ?? buildSkillsResponse());
  await mockSyncGlobalSkills(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const syncButton = (page: Page) =>
  page.getByRole('button', { name: /sync global skills/i });

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

test.describe('Studio Web — Skills', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(SKILLS_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders each skill returned by the API', async ({ page }) => {
      await setupPage(page);
      await page.goto(SKILLS_URL);

      await expect(page.getByText('Skill 1', { exact: true })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Skill 2', { exact: true })).toBeVisible();
      await expect(page.getByText('Skill 3', { exact: true })).toBeVisible();
    });

    test('renders the sync global skills button', async ({ page }) => {
      await setupPage(page);
      await page.goto(SKILLS_URL);

      await expect(syncButton(page)).toBeVisible({ timeout: 10000 });
    });

    test('renders an empty state when the API returns no skills', async ({ page }) => {
      await setupPage(page, {
        list: { data: [], meta: { current: 0, items: 0, number: 0, pages: 0, size: 10 } },
      });
      await page.goto(SKILLS_URL);

      // Sync button still visible while there are zero skill rows
      await expect(syncButton(page)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Skill 1', { exact: true })).toHaveCount(0);
    });
  });

  test.describe('Pagination params', () => {
    test('GET /o/skills forwards page/size from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockSkillsList(page);
      await mockSyncGlobalSkills(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/skills\?/.test(r.url()) &&
          r.url().includes('size=25') &&
          // Component subtracts 1 from the page query param before sending
          r.url().includes('page=1')
      );

      await page.goto(`${SKILLS_URL}?page=2&size=25`);
      await req;
    });

    test('GET /o/skills forwards query from URL', async ({ page }) => {
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockSkillsList(page);
      await mockSyncGlobalSkills(page);

      const req = page.waitForRequest(
        (r) =>
          r.method() === 'GET' &&
          /\/o\/skills\?/.test(r.url()) &&
          r.url().includes('query=python')
      );

      await page.goto(`${SKILLS_URL}?page=1&size=10&query=python`);
      await req;
    });
  });

  test.describe('Interaction', () => {
    test('clicking sync global skills triggers POST /o/skills/sync-global', async ({ page }) => {
      let called = false;
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockSkillsList(page);
      await mockSyncGlobalSkills(page, () => {
        called = true;
      });

      await page.goto(SKILLS_URL);

      const btn = syncButton(page);
      await expect(btn).toBeVisible({ timeout: 10000 });

      const [request] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'POST' && /\/o\/skills\/sync-global$/.test(r.url())),
        btn.click(),
      ]);

      expect(request.method()).toBe('POST');
      expect(called).toBe(true);
    });
  });

  test.describe('Delete', () => {
    test('confirming the delete modal triggers DELETE /o/skills/<id>', async ({ page }) => {
      let deletedId = '';
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockSkillsList(page);
      await mockSyncGlobalSkills(page);
      await mockDeleteSkill(page, (id) => {
        deletedId = id;
      });

      await page.goto(SKILLS_URL);

      const firstSkill = page.getByText('Skill 1', { exact: true });
      await expect(firstSkill).toBeVisible({ timeout: 10000 });

      // The skill row exposes edit + delete ActionIcons; the delete one is the
      // second action icon in the row (red, RiDeleteBinLineIcon).
      const row = firstSkill.locator('xpath=ancestor::*[contains(@class,"mantine-Card-root")][1]');
      const deleteIcon = row.locator('button').nth(2); // expand + edit + delete

      const confirm = page.getByRole('button', { name: /^confirm$/i });

      await deleteIcon.click();
      await expect(confirm).toBeVisible({ timeout: 5000 });

      const [request] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'DELETE' && /\/o\/skills\//.test(r.url())),
        confirm.click(),
      ]);

      expect(request.method()).toBe('DELETE');
      expect(deletedId).toBe('skill-1');
    });
  });

  test.describe('Inline edit', () => {
    test('saving an inline edit triggers PATCH /o/skills/<id> with the new key', async ({ page }) => {
      let patchedId = '';
      let patchedBody: any = null;
      await mockUserProfile(page);
      await mockProjectDictionary(page);
      await mockSkillsList(page);
      await mockSyncGlobalSkills(page);
      await mockUpdateSkill(page, (id, body) => {
        patchedId = id;
        patchedBody = body;
      });

      await page.goto(SKILLS_URL);

      await expect(page.getByText('Skill 1', { exact: true })).toBeVisible({ timeout: 10000 });

      // Each skill row is a Mantine Card containing an "Expand translations"
      // button. Anchor by the row's stable expand button — the edit/cancel
      // buttons swap mid-test so we can't anchor on them.
      const row = page.getByRole('button', { name: 'Expand translations' }).first()
        .locator('xpath=ancestor::*[contains(@class,"mantine-Card-root")][1]');
      await row.getByRole('button', { name: 'Edit' }).click();

      const input = row.getByRole('textbox');
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill('Skill 1 Renamed');

      const saveButton = row.getByRole('button', { name: /^save$/i });
      const [request] = await Promise.all([
        page.waitForRequest((r) => r.method() === 'PATCH' && /\/o\/skills\//.test(r.url())),
        saveButton.click(),
      ]);

      expect(request.method()).toBe('PATCH');
      expect(patchedId).toBe('skill-1');
      expect(patchedBody?.key).toBe('Skill 1 Renamed');
    });
  });

  test.describe('Edge cases', () => {
    test('renders skills even when project dictionary call fails', async ({ page }) => {
      await mockUserProfile(page);
      await mockSkillsList(page);
      await mockSyncGlobalSkills(page);
      await page.route('**/o/course/projects/options**', (route) => {
        if (!isApi(route)) return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'boom' }),
        });
      });

      await page.goto(SKILLS_URL);

      await expect(page.getByText('Skill 1', { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('renders a single skill when API returns one item', async ({ page }) => {
      await setupPage(page, {
        list: {
          data: [buildSkill(42, { key: 'Solo Skill' })],
          meta: { current: 0, items: 1, number: 1, pages: 1, size: 10 },
        },
      });
      await page.goto(SKILLS_URL);

      await expect(page.getByText('Solo Skill', { exact: true })).toBeVisible({ timeout: 10000 });
    });
  });
});
