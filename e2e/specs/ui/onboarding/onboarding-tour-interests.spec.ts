import { test, expect, Page, Route, Locator } from '@playwright/test';

/*
 * ASSUMPTIONS
 * 1. Auth: playwright.config.ts storageState (globalSetup) covers all tests.
 * 2. API endpoint patterns (update if base path differs):
 *      useGetUserPreference          GET  …/onboarding/user-preferences…
 *      useGetInterests               GET  …/onboarding/interests…
 *      useAddUserOnboardingInterests POST …/user-onboarding-interests…
 * 3. Each interest has `uuid` and `translations[0].value` (display label).
 * 4. Chips are Mantine UnstyledButton elements with aria-pressed set by the app.
 *    Selected state is detected via aria-pressed="true".
 * 5. Mantine notifications land in a DOM portal; detected via role="alert".
 * 6. The skeleton/loading state is detected via data-testid="onboarding-interests-loader"
 *    (app must add this — see below). Without it the loading test is skipped.
 * 7. Tests are parallel-safe; each runs in its own page context.
 *
 * LOCATOR MAP
 * interestChip(label) — getByRole('button', { name: label })
 *                       fallback: [data-testid="onboarding-interest-chip-<uuid>"]
 * continueBtn         — xpath //button[normalize-space()='Continue']
 *                       fallback: [data-testid="onboarding-interests-continue-btn"]
 * loader              — [data-testid="onboarding-interests-loader"]
 * errorMsg            — getByText('Failed to load interests. Please try again.')
 * notification        — role=alert
 *
 * RECOMMENDED TEST-ID HOOKS TO ADD IN APP CODE:
 *   data-testid="onboarding-interest-chip-<uuid>"     on each chip UnstyledButton
 *   data-testid="onboarding-interests-continue-btn"   on the Continue button
 *   data-testid="onboarding-interests-loader"         on the skeleton wrapper
 *   data-testid="onboarding-interests-card"           on the chip grid container
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const INTERESTS_URL = '/onboarding/tour/interests';

// ---------------------------------------------------------------------------
// Selector map
// ---------------------------------------------------------------------------
const SELECTORS = {
  // data-button is a stable Mantine attribute; combined with text it avoids
  // matching any other "Continue" button that may exist in the layout wrapper.
  continueButton: `xpath=//button[@data-button='true' and normalize-space()='Continue']`,
  loader: '.mantine-Skeleton-root',
  interestsCard: '[data-testid="onboarding-interests-card"]',
  errorMessage: `xpath=//*[contains(normalize-space(), 'Failed to load interests')]`,
  notification: '[role="alert"]',
} as const;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const INTEREST_A = { uuid: 'uuid-interest-a', label: 'Photography' };
const INTEREST_B = { uuid: 'uuid-interest-b', label: 'Cooking' };
const INTEREST_C = { uuid: 'uuid-interest-c', label: 'Travel' };

const ALL_INTERESTS = [INTEREST_A, INTEREST_B, INTEREST_C];

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildInterestsResponse(
  interests: Array<{ uuid: string; label: string }> = ALL_INTERESTS
) {
  return {
    data: interests.map((i) => ({
      uuid: i.uuid,
      translations: [{ value: i.label }],
    })),
  };
}

function buildUserPreferenceResponse(
  selectedInterestUuids: string[] = []
) {
  return {
    data: {
      interests: selectedInterestUuids.map((uuid) => ({ uuid })),
    },
  };
}

function buildSaveSuccessResponse() {
  return { data: { success: true } };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
// IMPORTANT: route.fallback() defers to the next matching handler. Using
// route.continue() here would let the request hit the live network and bypass
// any sibling handler registered for the same URL pattern (e.g. mockSaveApi).
async function mockInterestsApi(
  page: Page,
  interests: Array<{ uuid: string; label: string }> = ALL_INTERESTS
) {
  await page.route('**/onboarding/interests**', (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildInterestsResponse(interests)),
    });
  });
}

async function mockInterestsApiError(page: Page) {
  await page.route('**/onboarding/interests**', (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  });
}

async function mockUserPreferenceApi(
  page: Page,
  selectedInterestUuids: string[] = []
) {
  await page.route('**/onboarding/user-preferences**', (route: Route) => {
    if (
      route.request().resourceType() !== 'fetch' &&
      route.request().resourceType() !== 'xhr'
    ) {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserPreferenceResponse(selectedInterestUuids)),
    });
  });
}

async function mockSaveApi(
  page: Page,
  { fail = false, onRequest }: { fail?: boolean; onRequest?: (body: unknown) => void } = {}
) {
  // Real endpoint: ${API_URL}/o/user/onboarding/interests (PUT) — same URL as
  // the GET interests handler, distinguished only by HTTP method. Register
  // this handler AFTER mockInterestsApi so it matches PUT first; GET defers
  // to the next handler via route.fallback() (route.continue() would hit the
  // live network instead and bypass the GET mock).
  await page.route('**/onboarding/interests**', async (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    if (onRequest) onRequest(route.request().postDataJSON());
    if (fail) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Save failed' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildSaveSuccessResponse()),
    });
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const continueBtn = (page: Page) => page.locator(SELECTORS.continueButton);

// Primary: role-based. If strict mode fires (label matches multiple buttons),
// switch to: page.locator(`[data-testid="onboarding-interest-chip-${uuid}"]`)
const interestChip = (page: Page, label: string) =>
  page.getByRole('button', { name: label });

const loader = (page: Page) => page.locator(SELECTORS.loader).first();

const errorMessage = (page: Page) => page.locator(SELECTORS.errorMessage);

const notification = (page: Page) => page.locator(SELECTORS.notification);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
async function isChipSelected(chip: Locator): Promise<boolean> {
  return (await chip.getAttribute('aria-pressed')) === 'true';
}

async function setupPage(
  page: Page,
  {
    selectedInterestUuids = [],
    interests = ALL_INTERESTS,
    saveFail = false,
    interestsFail = false,
    onSave,
  }: {
    selectedInterestUuids?: string[];
    interests?: Array<{ uuid: string; label: string }>;
    saveFail?: boolean;
    interestsFail?: boolean;
    onSave?: (body: unknown) => void;
  } = {}
) {
  await mockUserPreferenceApi(page, selectedInterestUuids);
  if (interestsFail) {
    await mockInterestsApiError(page);
  } else {
    await mockInterestsApi(page, interests);
  }
  await mockSaveApi(page, { fail: saveFail, onRequest: onSave });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Tour Interests page', () => {
  // NOTE: tour/interests/index.tsx has no SSR auth gate. The previous
  // unauthenticated redirect test was removed because the page does not
  // implement it.

  // -------------------------------------------------------------------------
  // A) Initial render and loading
  // -------------------------------------------------------------------------
  test.describe('A) Initial render and loading', () => {
    test('shows Continue button on the page', async ({ page }) => {
      await setupPage(page);
      await page.goto(INTERESTS_URL);

      await expect(continueBtn(page)).toBeVisible({ timeout: 10000 });
    });

    test('shows skeleton loader while interests API is pending', async ({ page }) => {
      await mockUserPreferenceApi(page);

      // Hold interests response until we have confirmed the skeleton is visible.
      let resolveInterests!: () => void;
      const interestsGate = new Promise<void>((resolve) => { resolveInterests = resolve; });

      await page.route('**/onboarding/interests**', async (route: Route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await interestsGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildInterestsResponse()),
        });
      });
      await mockSaveApi(page);

      await page.goto(INTERESTS_URL);

      // Skeleton must be present while interests have not yet resolved.
      await expect(loader(page)).toBeVisible({ timeout: 10000 });

      // Unblock the API and confirm chips appear.
      resolveInterests();
      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
    });
  });

  // -------------------------------------------------------------------------
  // B) Load success
  // -------------------------------------------------------------------------
  test.describe('B) Load success', () => {
    test('renders all interest chips from mocked API', async ({ page }) => {
      await setupPage(page);
      await page.goto(INTERESTS_URL);

      for (const interest of ALL_INTERESTS) {
        await expect(interestChip(page, interest.label)).toBeVisible({ timeout: 10000 });
      }
    });

    test('Continue is disabled when no chips are selected', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // C) Preselected interests
  // -------------------------------------------------------------------------
  test.describe('C) Preselected interests', () => {
    test('chips matching user preference are rendered as selected', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      expect(await isChipSelected(interestChip(page, INTEREST_A.label))).toBe(true);
    });

    test('Continue is enabled when preselected interests exist', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeEnabled();
    });

    test('non-preselected chips are not selected', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_B.label)).toBeVisible({ timeout: 10000 });
      expect(await isChipSelected(interestChip(page, INTEREST_B.label))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // D) Toggle selection
  // -------------------------------------------------------------------------
  test.describe('D) Toggle selection', () => {
    test('clicking an unselected chip selects it and enables Continue', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeDisabled();

      await interestChip(page, INTEREST_A.label).click();

      expect(await isChipSelected(interestChip(page, INTEREST_A.label))).toBe(true);
      await expect(continueBtn(page)).toBeEnabled();
    });

    test('clicking a selected chip deselects it', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      expect(await isChipSelected(interestChip(page, INTEREST_A.label))).toBe(true);

      await interestChip(page, INTEREST_A.label).click();

      expect(await isChipSelected(interestChip(page, INTEREST_A.label))).toBe(false);
    });

    test('deselecting last selected chip disables Continue', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeEnabled();

      await interestChip(page, INTEREST_A.label).click();

      await expect(continueBtn(page)).toBeDisabled();
    });

    test('multiple chips can be selected independently', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });

      await interestChip(page, INTEREST_A.label).click();
      await interestChip(page, INTEREST_B.label).click();

      expect(await isChipSelected(interestChip(page, INTEREST_A.label))).toBe(true);
      expect(await isChipSelected(interestChip(page, INTEREST_B.label))).toBe(true);
      expect(await isChipSelected(interestChip(page, INTEREST_C.label))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // E) Save success
  // -------------------------------------------------------------------------
  test.describe('E) Save success', () => {
    test('clicking Continue sends selected UUIDs to save API', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await interestChip(page, INTEREST_A.label).click();
      await expect(interestChip(page, INTEREST_C.label)).toBeVisible({ timeout: 10000 });
      await interestChip(page, INTEREST_C.label).click();
      await expect(continueBtn(page)).toBeEnabled();

      const [request] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req.method() === 'PUT' && /\/onboarding\/interests(\?|$)/.test(req.url()),
          { timeout: 10000 }
        ),
        continueBtn(page).click(),
      ]);

      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 10000 });

      const body = request.postDataJSON() as string[];
      expect(body).toEqual(expect.arrayContaining([INTEREST_A.uuid, INTEREST_C.uuid]));
      expect(body).toHaveLength(2);
    });

    test('navigates to /onboarding/summary after successful save', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeEnabled();

      await Promise.all([
        page.waitForURL(/\/onboarding\/summary/, { timeout: 10000 }),
        continueBtn(page).click(),
      ]);
    });

    test('shows success notification after save', async ({ page }) => {
      await setupPage(page, { selectedInterestUuids: [INTEREST_A.uuid] });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(
        page.getByRole('alert').filter({ hasText: 'Your interests have been saved' })
      ).toBeVisible({ timeout: 10000 });
    });

    test('OnboardingLoader (svg overlay) appears while save is pending', async ({ page }) => {
      // Hold the PUT response so we can observe the in-flight UI.
      let resolveSave!: () => void;
      const saveGate = new Promise<void>((r) => { resolveSave = r; });

      await mockUserPreferenceApi(page, [INTEREST_A.uuid]);
      await mockInterestsApi(page);
      await page.route('**/onboarding/interests**', async (route: Route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await saveGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildSaveSuccessResponse()),
        });
      });

      await page.goto(INTERESTS_URL);
      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      // OnboardingLoader renders a bare <svg role="presentation"> (Mantine v5 Loader).
      await expect(page.locator('svg[role="presentation"]').first()).toBeVisible({ timeout: 10000 });

      // Chips become non-interactive while submitting (opacity 0.6, cursor not-allowed).
      const chipCursor = await interestChip(page, INTEREST_B.label).evaluate(
        (el) => window.getComputedStyle(el as HTMLElement).cursor
      );
      expect(chipCursor).toBe('not-allowed');

      resolveSave();
      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 10000 });
    });
  });

  // -------------------------------------------------------------------------
  // F) Save error
  // -------------------------------------------------------------------------
  test.describe('F) Save error', () => {
    test('shows error notification when save API fails', async ({ page }) => {
      await setupPage(page, {
        selectedInterestUuids: [INTEREST_A.uuid],
        saveFail: true,
      });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(notification(page).first()).toBeVisible({ timeout: 10000 });
    });

    test('stays on the interests page when save API fails', async ({ page }) => {
      await setupPage(page, {
        selectedInterestUuids: [INTEREST_A.uuid],
        saveFail: true,
      });
      await page.goto(INTERESTS_URL);

      await expect(interestChip(page, INTEREST_A.label)).toBeVisible({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(notification(page).first()).toBeVisible({ timeout: 10000 });
      await expect(page).toHaveURL(new RegExp(INTERESTS_URL));
    });
  });

  // -------------------------------------------------------------------------
  // G) Interests fetch error
  // -------------------------------------------------------------------------
  test.describe('G) Interests fetch error', () => {
    test('shows error notification when interests API fails', async ({ page }) => {
      await setupPage(page, { interestsFail: true });
      await page.goto(INTERESTS_URL);

      await expect(
        page.getByRole('alert').filter({ hasText: 'Failed to load interests. Please try again.' })
      ).toBeVisible({ timeout: 10000 });
    });

    test('Continue is disabled when interests failed to load', async ({ page }) => {
      await setupPage(page, { interestsFail: true });
      await page.goto(INTERESTS_URL);

      await expect(continueBtn(page)).toBeDisabled({ timeout: 10000 });
    });
  });
});
