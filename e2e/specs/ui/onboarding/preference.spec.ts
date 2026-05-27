import { test, expect, Page, Route, Locator } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PREFERENCE_URL = '/onboarding/preference';

type LearningPreference = 'avatar' | 'voice' | 'text';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserPreferenceResponse(
  learningPreference: LearningPreference = 'avatar',
  avatarName = 'Emma'
) {
  return {
    data: {
      learning_preference: learningPreference,
      avatar: { name: avatarName, uuid: 'avatar-uuid-1' },
    },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
async function mockUserPreferenceApi(
  page: Page,
  preference: LearningPreference = 'avatar',
  avatarName = 'Emma'
) {
  await page.route('**/onboarding/user-preferences**', (route: Route) => {
    if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserPreferenceResponse(preference, avatarName)),
    });
  });
}

async function mockPatchUserProfileApi(
  page: Page,
  onRequest?: (body: Record<string, unknown>) => void
) {
  // Preference.tsx:60–66 reads res?.data?.learning_mode_preference from the
  // PATCH response to decide the redirect=summary route. Since api.patch
  // returns response.data (the body), the mock body must shape as
  // `{ data: { learning_mode_preference } }` — and the value MUST echo the
  // request body, otherwise the source falls back to 'avatar' for every test.
  await page.route('**/user/profile**', async (route: Route) => {
    if (route.request().method() !== 'PATCH') {
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
          learning_mode_preference: body?.learning_mode_preference,
        },
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const headingHowShouldCommunicate = (page: Page) =>
  page.locator(
    `xpath=//h1[contains(normalize-space(), 'How should') and contains(normalize-space(), 'communicate')]`
  );

const headingWithName = (page: Page, name: string) =>
  page.locator(
    `xpath=//h1[contains(normalize-space(), 'How should') and contains(normalize-space(), '${name}') and contains(normalize-space(), 'communicate')]`
  );

const subtitleChooseResponseMode = (page: Page) =>
  page.locator(
    `xpath=//div[normalize-space()="Choose how you'd like to receive responses"]`
  );

const continueBtn = (page: Page) =>
  page.locator(`xpath=//button[normalize-space()='Continue']`);

const avatarModeCard = (page: Page) =>
  page.locator('[aria-pressed]').filter({ hasText: 'Avatar mode' });

const audioModeCard = (page: Page) =>
  page.locator('[aria-pressed]').filter({ hasText: 'Audio' });

const textOnlyModeCard = (page: Page) =>
  page.locator('[aria-pressed]').filter({ hasText: 'Text only' });

const avatarModeTitle = (page: Page) =>
  page.locator(`xpath=//*[normalize-space()='Avatar mode']`);

const audioModeTitle = (page: Page) =>
  page.locator(`xpath=//*[normalize-space()='Audio']`);

const textOnlyModeTitle = (page: Page) =>
  page.locator(`xpath=//*[normalize-space()='Text only']`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function isCardSelected(card: Locator): Promise<boolean> {
  return (await card.getAttribute('aria-pressed')) === 'true';
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
async function setupPage(
  page: Page,
  {
    preference = 'avatar' as LearningPreference,
    avatarName = 'Emma',
    patchSpy,
  }: {
    preference?: LearningPreference;
    avatarName?: string;
    patchSpy?: (body: Record<string, unknown>) => void;
  } = {}
) {
  await mockUserPreferenceApi(page, preference, avatarName);
  await mockPatchUserProfileApi(page, patchSpy);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Preference page', () => {
  test.describe('Rendering', () => {
    test('renders heading, subtitle, continue button, and all 3 mode cards', async ({ page }) => {
      await setupPage(page);
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await expect(subtitleChooseResponseMode(page)).toBeVisible();
      await expect(continueBtn(page)).toBeVisible();

      await expect(avatarModeTitle(page)).toBeVisible();
      await expect(audioModeTitle(page)).toBeVisible();
      await expect(textOnlyModeTitle(page)).toBeVisible();
    });

    test('heading includes the avatar name from the API', async ({ page }) => {
      await setupPage(page, { avatarName: 'Emma' });
      await page.goto(PREFERENCE_URL);

      await expect(headingWithName(page, 'Emma')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Initial selected mode from API', () => {
    test('reflects voice preference from API as initially selected', async ({ page }) => {
      await setupPage(page, { preference: 'voice' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });

      const card = audioModeCard(page);
      await expect(card).toBeVisible();
      expect(await isCardSelected(card)).toBe(true);
    });

    test('reflects text preference from API as initially selected', async ({ page }) => {
      await setupPage(page, { preference: 'text' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });

      const card = textOnlyModeCard(page);
      await expect(card).toBeVisible();
      expect(await isCardSelected(card)).toBe(true);
    });
  });

  test.describe('Mode card selection', () => {
    test('clicking a different card updates the visual selection', async ({ page }) => {
      await setupPage(page, { preference: 'avatar' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });

      await audioModeCard(page).click();

      const audioCard = audioModeCard(page);
      expect(await isCardSelected(audioCard)).toBe(true);
    });

    test('clicking text-only card selects it', async ({ page }) => {
      await setupPage(page, { preference: 'avatar' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await textOnlyModeCard(page).click();

      expect(await isCardSelected(textOnlyModeCard(page))).toBe(true);
    });
  });

  test.describe('Continue — PATCH payload', () => {
    test('sends PATCH with learning_mode_preference matching selected mode', async ({ page }) => {
      let capturedBody: Record<string, unknown> = {};

      await setupPage(page, {
        preference: 'avatar',
        patchSpy: (body) => { capturedBody = body; },
      });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });

      // Switch to voice then continue
      await audioModeCard(page).click();

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'PATCH' && req.url().includes('user/profile')
        ),
        continueBtn(page).click(),
      ]);

      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ learning_mode_preference: 'voice' });
    });

    test('sends PATCH with avatar when avatar card is selected', async ({ page }) => {
      await setupPage(page, { preference: 'text' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await avatarModeCard(page).click();

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'PATCH' && req.url().includes('user/profile')
        ),
        continueBtn(page).click(),
      ]);

      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ learning_mode_preference: 'avatar' });
    });

    test('sends PATCH with text when text-only card is selected', async ({ page }) => {
      await setupPage(page, { preference: 'avatar' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await textOnlyModeCard(page).click();

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'PATCH' && req.url().includes('user/profile')
        ),
        continueBtn(page).click(),
      ]);

      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ learning_mode_preference: 'text' });
    });
  });

  test.describe('Default selection', () => {
    test('falls back to avatar mode when API returns no learning_preference', async ({ page }) => {
      // Source: Preference.tsx:22 — selectedMode = data?.learning_preference || 'avatar'.
      await page.route('**/onboarding/user-preferences**', (route: Route) => {
        if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
          return route.continue();
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { avatar: { name: 'Emma', uuid: 'avatar-uuid-1' } } }),
        });
      });
      await mockPatchUserProfileApi(page);

      await page.goto(PREFERENCE_URL);
      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });

      const card = avatarModeCard(page);
      await expect(card).toBeVisible();
      expect(await isCardSelected(card)).toBe(true);
    });
  });

  test.describe('Loading overlay during PATCH', () => {
    test('OnboardingLoader (svg overlay) appears while PATCH is pending', async ({ page }) => {
      let resolvePatch!: () => void;
      const patchGate = new Promise<void>((r) => { resolvePatch = r; });

      await mockUserPreferenceApi(page, 'avatar');
      await page.route('**/user/profile**', async (route: Route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        await patchGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { success: true, learning_mode_preference: 'avatar' } }),
        });
      });

      await page.goto(PREFERENCE_URL);
      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page.locator('svg[role="presentation"]').first()).toBeVisible({ timeout: 10000 });

      resolvePatch();
      await expect(page).toHaveURL(/\/onboarding\/tour/, { timeout: 10000 });
    });
  });

  test.describe('Navigation — without redirect=summary', () => {
    test('navigates to /onboarding/tour after successful continue', async ({ page }) => {
      await setupPage(page, { preference: 'avatar' });
      await page.goto(PREFERENCE_URL);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour/, { timeout: 10000 });
    });
  });

  test.describe('Navigation — with redirect=summary', () => {
    test('avatar mode navigates to /onboarding/tour/avatar?redirect=summary', async ({ page }) => {
      await setupPage(page, { preference: 'avatar' });
      await page.goto(`${PREFERENCE_URL}?redirect=summary`);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await avatarModeCard(page).click();
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/avatar.*redirect=summary/, { timeout: 10000 });
    });

    test('voice mode navigates to /onboarding/tour/audio?redirect=summary', async ({ page }) => {
      await setupPage(page, { preference: 'voice' });
      await page.goto(`${PREFERENCE_URL}?redirect=summary`);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await audioModeCard(page).click();
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/audio.*redirect=summary/, { timeout: 10000 });
    });

    test('text mode navigates to /onboarding/tour/text?redirect=summary', async ({ page }) => {
      await setupPage(page, { preference: 'text' });
      await page.goto(`${PREFERENCE_URL}?redirect=summary`);

      await expect(headingHowShouldCommunicate(page)).toBeVisible({ timeout: 10000 });
      await textOnlyModeCard(page).click();
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/text.*redirect=summary/, { timeout: 10000 });
    });
  });
});
