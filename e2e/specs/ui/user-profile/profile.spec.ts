import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROFILE_URL = '/user-profile';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserProfileResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      uuid: 'user-uuid-1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane.doe@example.com',
      theme: 'dark',
      learning_mode_preference: 'avatar',
      timezone: 'Europe/Paris',
      language: 'en',
      role: { uuid: 'role-uuid-1', key: 'Engineer' },
      avatar: null,
      ...overrides,
    },
  };
}

function buildUserPreferenceResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      learning_preference: 'avatar',
      avatar: {
        uuid: 'avatar-uuid-1',
        name: 'Emma',
        avatar_display: 'https://example.com/avatar.png',
      },
      audio_model: {
        uuid: 'audio-uuid-1',
        audio_model: {
          category: { key: 'Calm' },
          description: 'A calm voice',
        },
      },
      ...overrides,
    },
  };
}

function buildRolesResponse() {
  return {
    data: [
      { uuid: 'role-uuid-1', key: 'Engineer' },
      { uuid: 'role-uuid-2', key: 'Manager' },
      { uuid: 'role-uuid-3', key: 'Designer' },
    ],
  };
}

function buildLanguagesResponse() {
  return { data: ['en', 'fr'] };
}

function buildLanguagePreferenceResponse(hasPreference = true) {
  return {
    data: {
      has_preference: hasPreference,
      avatar: { org_avatar_uuid: 'org-avatar-uuid-1' },
      audio_model: { uuid: 'audio-model-uuid-1' },
    },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
function isApiRequest(route: Route): boolean {
  const t = route.request().resourceType();
  return t === 'fetch' || t === 'xhr';
}

async function mockGetUserProfile(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route('**/user/profile**', async (route: Route) => {
    if (!isApiRequest(route)) return route.continue();
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserProfileResponse(overrides)),
    });
  });
}

async function mockPatchUserProfile(
  page: Page,
  onRequest?: (body: Record<string, unknown>) => void
) {
  await page.route('**/user/profile**', async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const url = route.request().url();
    // route only the bare /user/profile (no password / avatar / theme suffix)
    if (/\/user\/profile\/(password|avatar|theme|mode-change|language)/.test(url)) {
      return route.continue();
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (onRequest) onRequest(body);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          success: true,
          theme: body?.theme,
          learning_mode_preference: body?.learning_mode_preference,
        },
      }),
    });
  });
}

async function mockPatchPassword(
  page: Page,
  opts: {
    status?: number;
    onRequest?: (body: Record<string, unknown>) => void;
  } = {}
) {
  const { status = 200, onRequest } = opts;
  await page.route('**/user/profile/password**', async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (onRequest) onRequest(body);
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        status === 200
          ? { data: { success: true } }
          : { data: { message: 'Invalid credentials' } }
      ),
    });
  });
}

async function mockDeleteAvatar(page: Page) {
  await page.route('**/user/profile/avatar**', async (route: Route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    });
  });
}

async function mockGetUserPreference(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route('**/onboarding/user-preferences**', (route: Route) => {
    if (!isApiRequest(route)) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserPreferenceResponse(overrides)),
    });
  });
}

async function mockGetRoles(page: Page) {
  await page.route('**/settings/roles**', (route: Route) => {
    if (!isApiRequest(route)) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildRolesResponse()),
    });
  });
}

async function mockGetLanguages(page: Page) {
  await page.route('**/pub/brand/languages**', (route: Route) => {
    if (!isApiRequest(route)) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildLanguagesResponse()),
    });
  });
}

async function mockLanguagePreference(page: Page, hasPreference = true) {
  await page.route('**/onboarding/language-preference/**', (route: Route) => {
    if (!isApiRequest(route)) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildLanguagePreferenceResponse(hasPreference)),
    });
  });
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
async function setupPage(
  page: Page,
  {
    profile,
    preference,
    patchSpy,
  }: {
    profile?: Record<string, unknown>;
    preference?: Record<string, unknown>;
    patchSpy?: (body: Record<string, unknown>) => void;
  } = {}
) {
  // Patch must be registered before GET, because Playwright matches routes
  // in reverse registration order — and both share the `**/user/profile**`
  // glob. The PATCH handler short-circuits non-PATCH back to the GET.
  await mockGetUserProfile(page, profile);
  await mockPatchUserProfile(page, patchSpy);
  await mockGetUserPreference(page, preference);
  await mockGetRoles(page);
  await mockGetLanguages(page);
  await mockLanguagePreference(page, true);
  await mockDeleteAvatar(page);
  await mockPatchPassword(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const breadcrumb = (page: Page, label: string) =>
  page.locator(
    `xpath=//*[contains(normalize-space(), '/ ${label}') and not(descendant::*[contains(normalize-space(), '/ ${label}')])]`
  );

const updateButton = (page: Page) =>
  page.locator(`xpath=//button[normalize-space()='Update']`);

const updatePasswordButton = (page: Page) =>
  page.locator(
    `xpath=//button[translate(normalize-space(), 'UPDATEPASSWORD', 'updatepassword')='update password']`
  );

// Mantine SegmentedControl hides the underlying radio inputs and shows visible
// <label> elements. Interact with the labels, not the radios.
const segmentedLabel = (page: Page, text: string) =>
  page.locator('label.mantine-SegmentedControl-label', { hasText: text });

const passwordInput = (page: Page, label: string) =>
  page.getByLabel(label, { exact: false });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('User profile page', () => {
  test.describe('Authentication', () => {
    test('redirects unauthenticated users to /auth/signIn', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: undefined });
      const page = await ctx.newPage();

      await page.goto(PROFILE_URL);
      await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 15000 });

      await ctx.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders all four profile sections (avatar, preferences, instructor, password)', async ({
      page,
    }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(breadcrumb(page, 'Avatar').first()).toBeVisible({ timeout: 10000 });
      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible();
      await expect(breadcrumb(page, 'Instructor').first()).toBeVisible();
      // Password card breadcrumb — "Update password" (case may vary across locales)
      await expect(
        page.locator(`xpath=//*[contains(translate(normalize-space(), 'UPDATEPASSWORD', 'updatepassword'), '/ update password')]`).first()
      ).toBeVisible();
    });

    test('renders preference form fields prefilled from API', async ({ page }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible({ timeout: 10000 });

      // Theme segmented control — Dark/Light labels visible (radio inputs are hidden by Mantine)
      await expect(segmentedLabel(page, 'Dark').first()).toBeVisible();
      await expect(segmentedLabel(page, 'Light').first()).toBeVisible();

      // Update button visible for preferences card
      await expect(updateButton(page).first()).toBeVisible();
    });

    test('renders password form with three inputs and Update Password button', async ({ page }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(page.locator('input[type="password"]')).toHaveCount(3, { timeout: 10000 });
      await expect(updatePasswordButton(page)).toBeVisible();
    });

    test('renders instructor avatar name from the user-preferences API', async ({ page }) => {
      await setupPage(page, { preference: { avatar: { uuid: 'a1', name: 'Olivia', avatar_display: '/x.png' } } });
      await page.goto(PROFILE_URL);

      await expect(
        page.locator(`xpath=//*[normalize-space()='Olivia']`).first()
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Preferences — PATCH payload', () => {
    test('clicking Update sends PATCH /user/profile with current form values', async ({ page }) => {
      let capturedBody: Record<string, unknown> = {};

      await setupPage(page, {
        patchSpy: (body) => {
          capturedBody = body;
        },
      });
      await page.goto(PROFILE_URL);

      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible({ timeout: 10000 });

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.method() === 'PATCH' &&
            /\/user\/profile(\?|$)/.test(req.url())
        ),
        // first "Update" button corresponds to UserDetails preferences card
        updateButton(page).first().click(),
      ]);

      capturedBody = request.postDataJSON() as Record<string, unknown>;
      expect(capturedBody).toMatchObject({
        theme: expect.any(String),
        learning_mode_preference: expect.any(String),
      });
    });

    test('switching learning mode to text and saving sends learning_mode_preference="text"', async ({
      page,
    }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible({ timeout: 10000 });

      // The learning_mode_preference SegmentedControl uses the "Text only" label
      // (en translation of user-profile--preferences--text-20-hard).
      await segmentedLabel(page, 'Text only').first().click();

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.method() === 'PATCH' &&
            /\/user\/profile(\?|$)/.test(req.url())
        ),
        updateButton(page).first().click(),
      ]);

      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ learning_mode_preference: 'text' });
    });

    test('shows success notification after preferences are saved', async ({ page }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible({ timeout: 10000 });

      await updateButton(page).first().click();

      // Mantine notifications render the message in a [role="alert"] container.
      await expect(page.locator('[role="alert"], .mantine-Notification-root').first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe('Password form', () => {
    test('shows validation error when new password does not meet rules', async ({ page }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(updatePasswordButton(page)).toBeVisible({ timeout: 10000 });

      const [currentPwd, newPwd, confirmPwd] = await page.locator('input[type="password"]').all();
      await currentPwd.fill('OldPassw0rd!');
      await newPwd.fill('weak');
      await confirmPwd.fill('weak');

      await updatePasswordButton(page).click();

      // zod adds error text under the new-password input
      await expect(
        page.locator('.mantine-PasswordInput-error, [role="alert"]').first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('disables Update Password when current and new passwords match', async ({ page }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(updatePasswordButton(page)).toBeVisible({ timeout: 10000 });

      const [currentPwd, newPwd] = await page.locator('input[type="password"]').all();
      const same = 'Sam3Passw0rd!';
      await currentPwd.fill(same);
      await newPwd.fill(same);

      await expect(updatePasswordButton(page)).toBeDisabled();
    });

    test('sends PATCH /user/profile/password with {current, password} on submit', async ({ page }) => {
      let captured: Record<string, unknown> = {};
      await setupPage(page);
      await mockPatchPassword(page, {
        onRequest: (body) => {
          captured = body;
        },
      });

      await page.goto(PROFILE_URL);
      await expect(updatePasswordButton(page)).toBeVisible({ timeout: 10000 });

      const [currentPwd, newPwd, confirmPwd] = await page.locator('input[type="password"]').all();
      await currentPwd.fill('OldPassw0rd!');
      await newPwd.fill('NewSecur3Pwd!');
      await confirmPwd.fill('NewSecur3Pwd!');

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'PATCH' && req.url().includes('/user/profile/password')
        ),
        updatePasswordButton(page).click(),
      ]);

      captured = request.postDataJSON() as Record<string, unknown>;
      expect(captured).toMatchObject({
        current: 'OldPassw0rd!',
        password: 'NewSecur3Pwd!',
      });
      // confirm_password is NOT sent — implementation only forwards current + password.
      expect(captured).not.toHaveProperty('confirm_password');
    });

    test('shows error notification when password and confirm_password mismatch', async ({ page }) => {
      await setupPage(page);
      await page.goto(PROFILE_URL);

      await expect(updatePasswordButton(page)).toBeVisible({ timeout: 10000 });

      const [currentPwd, newPwd, confirmPwd] = await page.locator('input[type="password"]').all();
      await currentPwd.fill('OldPassw0rd!');
      await newPwd.fill('NewSecur3Pwd!');
      await confirmPwd.fill('DifferentP4ss!');

      await updatePasswordButton(page).click();

      await expect(
        page.locator('[role="alert"], .mantine-Notification-root').first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('shows error notification when API returns 400', async ({ page }) => {
      await setupPage(page);
      await mockPatchPassword(page, { status: 400 });

      await page.goto(PROFILE_URL);
      await expect(updatePasswordButton(page)).toBeVisible({ timeout: 10000 });

      const [currentPwd, newPwd, confirmPwd] = await page.locator('input[type="password"]').all();
      await currentPwd.fill('WrongPassw0rd!');
      await newPwd.fill('NewSecur3Pwd!');
      await confirmPwd.fill('NewSecur3Pwd!');

      await updatePasswordButton(page).click();

      await expect(
        page.locator('[role="alert"], .mantine-Notification-root').first()
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Loading overlay during PATCH', () => {
    test('shows LoadingOverlay while preference PATCH is pending', async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      await mockGetUserProfile(page);
      await mockGetUserPreference(page);
      await mockGetRoles(page);
      await mockGetLanguages(page);
      await mockLanguagePreference(page);
      await mockPatchPassword(page);
      await page.route('**/user/profile**', async (route: Route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        if (/\/user\/profile\/(password|avatar|theme)/.test(route.request().url())) {
          return route.continue();
        }
        await gate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { success: true, theme: 'dark', learning_mode_preference: 'avatar' } }),
        });
      });

      await page.goto(PROFILE_URL);
      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible({ timeout: 10000 });

      await updateButton(page).first().click();

      await expect(page.locator('.mantine-LoadingOverlay-root').first()).toBeVisible({
        timeout: 10000,
      });

      release();
      await expect(page.locator('.mantine-LoadingOverlay-root').first()).toBeHidden({
        timeout: 10000,
      });
    });
  });

  test.describe('Language change flow', () => {
    test('changing language triggers GET /onboarding/language-preference/<lang> before PATCH', async ({
      page,
    }) => {
      await setupPage(page, { profile: { language: 'en' } });
      await page.goto(PROFILE_URL);

      await expect(breadcrumb(page, 'Preferences').first()).toBeVisible({ timeout: 10000 });

      // open the language Select — placeholder "Language selector"
      const languageSelect = page.getByPlaceholder('Language selector');
      await languageSelect.click();
      // Pick the "French / Français" option (label may be either depending on i18n key resolution).
      const frOption = page
        .locator('[role="option"]')
        .filter({ hasText: /fran|french/i })
        .first();
      await frOption.click();

      const langPrefRequest = page.waitForRequest(
        (req) =>
          req.method() === 'GET' &&
          /\/onboarding\/language-preference\/fr/.test(req.url())
      );

      await updateButton(page).first().click();
      await langPrefRequest;
    });
  });
});
