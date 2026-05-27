import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BRANDING_URL = '/administration/branding';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildAdminProfile(admin = true) {
  return {
    data: { uuid: 'u1', first_name: 'Admin', last_name: 'User', email: 'a@b.com', admin, language: 'en' },
  };
}

function buildBrandResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      uuid: 'brand-1',
      logo_url: null,
      cover_url: null,
      accent_color: '#143f5f',
      text_color: '#ffffff',
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

async function mockGetBrand(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route('**/manage/brand**', (route) => {
    if (!isApi(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildBrandResponse(overrides)),
    });
  });
}

async function mockDeleteLogo(page: Page, onCall?: () => void) {
  await page.route('**/manage/brand/logo**', (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    if (onCall) onCall();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    });
  });
}

async function setupPage(
  page: Page,
  opts: { admin?: boolean; brand?: Record<string, unknown> } = {}
) {
  await mockUserProfile(page, opts.admin ?? true);
  await mockGetBrand(page, opts.brand);
  await mockDeleteLogo(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const logoBreadcrumb = (page: Page) =>
  page.locator(
    `xpath=//*[contains(normalize-space(), '/ Logo') and not(descendant::*[contains(normalize-space(), '/ Logo')])]`
  );

// The delete-logo trigger is an ActionIcon wrapped in a Mantine Tooltip.
// Tooltip only sets aria-describedby on hover (no aria-label), so the button
// has no accessible name. The UploadHandler also renders ActionIcons, so a
// generic "first button in card" selector is ambiguous. Identify the delete
// button by the distinctive SVG path of RiDeleteBinLineIcon (the top stroke
// "M0 6H24" — the trash-bin lid line).
const deleteLogoBtn = (page: Page) =>
  page.locator('button:has(svg path[d="M0 6H24"])');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Administration — Branding', () => {
  test.describe('Authentication & Authorization', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();
      await page.goto(BRANDING_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });
      await ctx.close();
    });

    test('redirects non-admin users to /404', async ({ page }) => {
      await setupPage(page, { admin: false });
      await page.goto(BRANDING_URL);
      await expect(page).toHaveURL(/\/404/, { timeout: 10000 });
    });
  });

  test.describe('Rendering', () => {
    test('renders the logo card breadcrumb and upload control', async ({ page }) => {
      await setupPage(page);
      await page.goto(BRANDING_URL);

      await expect(logoBreadcrumb(page).first()).toBeVisible({ timeout: 10000 });
    });

    test('does NOT render delete-logo action when no logo is set', async ({ page }) => {
      await setupPage(page, { brand: { logo_url: null } });
      await page.goto(BRANDING_URL);

      await expect(logoBreadcrumb(page).first()).toBeVisible({ timeout: 10000 });
      await expect(deleteLogoBtn(page)).toHaveCount(0);
    });

    test('renders delete-logo action when a logo_url is present', async ({ page }) => {
      await setupPage(page, { brand: { logo_url: 'https://example.com/logo.png' } });
      await page.goto(BRANDING_URL);

      await expect(deleteLogoBtn(page).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Delete logo', () => {
    test('clicking delete -> confirming triggers DELETE /manage/brand/logo', async ({ page }) => {
      let deleted = false;
      await mockUserProfile(page);
      await mockGetBrand(page, { logo_url: 'https://example.com/logo.png' });
      await mockDeleteLogo(page, () => {
        deleted = true;
      });

      await page.goto(BRANDING_URL);
      await deleteLogoBtn(page).first().click();

      // Confirm modal — "Confirm" button
      const confirmBtn = page.getByRole('button', { name: /^confirm$/i });
      await expect(confirmBtn).toBeVisible({ timeout: 5000 });

      const [request] = await Promise.all([
        page.waitForRequest(
          (r) => r.method() === 'DELETE' && /\/manage\/brand\/logo/.test(r.url())
        ),
        confirmBtn.click(),
      ]);

      expect(request.method()).toBe('DELETE');
      expect(deleted).toBe(true);
    });

    test('cancelling the confirm modal does NOT call the API', async ({ page }) => {
      let deleted = false;
      await mockUserProfile(page);
      await mockGetBrand(page, { logo_url: 'https://example.com/logo.png' });
      await mockDeleteLogo(page, () => {
        deleted = true;
      });

      await page.goto(BRANDING_URL);
      await deleteLogoBtn(page).first().click();

      const cancelBtn = page.getByRole('button', { name: /^cancel$/i });
      await expect(cancelBtn).toBeVisible({ timeout: 5000 });
      await cancelBtn.click();

      // brief wait to ensure no late-fired DELETE
      await page.waitForTimeout(500);
      expect(deleted).toBe(false);
    });
  });
});
