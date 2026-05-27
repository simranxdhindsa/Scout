import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOUR_URL = '/onboarding/tour';
const SIGN_IN_URL = '/auth/signIn';

type LearningPreference = 'avatar' | 'voice' | 'text';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserPreferenceResponse(learningPreference?: LearningPreference) {
  return {
    data: {
      learning_preference: learningPreference,
      avatar: { name: 'Emma', avatar_display: '/avatar.png' },
    },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
async function mockUserPreferenceApi(page: Page, learningPreference?: LearningPreference) {
  await page.route('**/onboarding/user-preferences**', (route: Route) => {
    if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserPreferenceResponse(learningPreference)),
    });
  });
}

async function setupPage(page: Page, learningPreference?: LearningPreference) {
  await mockUserPreferenceApi(page, learningPreference);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const titleLine1 = (page: Page) =>
  page.locator(
    `xpath=//h3[contains(normalize-space(), "We've got the basics.")] | //h1[contains(normalize-space(), "We've got the basics.")]`
  );

const titleLine2 = (page: Page) =>
  page.locator(
    `xpath=//h3[contains(normalize-space(), "Let's get to know each other.")] | //h1[contains(normalize-space(), "Let's get to know each other.")]`
  );

const tourSubtitle = (page: Page) =>
  page.locator(
    `xpath=//div[contains(normalize-space(), "We'd like to give you a brief tour of the system") and not(descendant::div[contains(normalize-space(), "We'd like to give you a brief tour of the system")])]`
  );

const takeTourCard = (page: Page) =>
  page.locator(
    `xpath=//*[normalize-space()='Take a tour & get to know each other']/ancestor::*[self::div or self::article][1]`
  );

const takeTourText = (page: Page) =>
  page.locator(`xpath=//*[normalize-space()='Take a tour & get to know each other']`);

const recommendedText = (page: Page) =>
  page.locator(`xpath=//*[normalize-space()='Recommended']`);

const doItLaterCard = (page: Page) =>
  page.locator(
    `xpath=//*[normalize-space()='Do it later']/ancestor::div[contains(@class, 'mantine-Card-root')]`
  );

const doItLaterText = (page: Page) =>
  page.locator(`xpath=//*[normalize-space()='Do it later' and not(descendant::*[normalize-space()='Do it later'])]`);

// Header renders "<Text>{currentStep}<span>/</span>8</Text>" — both the Text
// element and its child span have a normalized text of "4/8", so we scope to
// the inner Mantine Text and pick the first match to avoid strict-mode errors.
const stepIndicator = (page: Page) =>
  page.locator('.mantine-Text-root', { hasText: /^4\s*\/\s*8$/ }).first();

const tourAvatarImg = (page: Page) =>
  page.locator(`xpath=//img[contains(@src, 'avatar') or contains(@src, '/avatar.png')]`).first();

const tourSkeleton = (page: Page) => page.locator('.mantine-Skeleton-root').first();

const backBtn = (page: Page) =>
  page.locator(`xpath=//button[normalize-space()='Back']`);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Tour page', () => {
  test.describe('Authentication', () => {
    test('unauthenticated request is redirected to /auth/signIn', async ({ browser }) => {
      // Fresh context with no stored session — simulates an unauthenticated user
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();
      await page.goto(TOUR_URL);
      await expect(page).toHaveURL(new RegExp(SIGN_IN_URL));
      await context.close();
    });
  });

  test.describe('Rendering', () => {
    test('renders all main tour texts and CTAs', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(TOUR_URL);

      await expect(titleLine1(page)).toBeVisible({ timeout: 10000 });
      await expect(titleLine2(page)).toBeVisible();
      await expect(tourSubtitle(page)).toBeVisible();
      await expect(takeTourText(page)).toBeVisible();
      await expect(recommendedText(page)).toBeVisible();
      await expect(doItLaterText(page)).toBeVisible();
    });

    test('shows step indicator 4/8 when no redirect=summary', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(TOUR_URL);

      await expect(titleLine1(page)).toBeVisible({ timeout: 10000 });
      await expect(stepIndicator(page)).toBeVisible();
    });

    test('shows back button in onboarding layout', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(TOUR_URL);

      await expect(titleLine1(page)).toBeVisible({ timeout: 10000 });
      await expect(backBtn(page)).toBeVisible();
    });

    test('renders avatar image from user preference', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(TOUR_URL);

      await expect(titleLine1(page)).toBeVisible({ timeout: 10000 });
      await expect(tourAvatarImg(page)).toBeVisible();
    });

    test('shows skeleton while user-preference API is pending', async ({ page }) => {
      let resolvePrefs!: () => void;
      const prefsGate = new Promise<void>((r) => { resolvePrefs = r; });

      await page.route('**/onboarding/user-preferences**', async (route: Route) => {
        if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
          return route.continue();
        }
        await prefsGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildUserPreferenceResponse('avatar')),
        });
      });

      await page.goto(TOUR_URL);
      await expect(tourSkeleton(page)).toBeVisible({ timeout: 10000 });

      resolvePrefs();
      await expect(takeTourText(page)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Primary CTA navigation', () => {
    test('routes to /onboarding/tour/avatar when preference is avatar', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(TOUR_URL);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/avatar/, { timeout: 10000 });
    });

    test('routes to /onboarding/tour/audio when preference is voice', async ({ page }) => {
      await setupPage(page, 'voice');
      await page.goto(TOUR_URL);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/audio/, { timeout: 10000 });
    });

    test('routes to /onboarding/tour/text when preference is text', async ({ page }) => {
      await setupPage(page, 'text');
      await page.goto(TOUR_URL);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/text/, { timeout: 10000 });
    });

    test('falls back to /onboarding/tour/avatar when preference is missing', async ({ page }) => {
      await setupPage(page, undefined);
      await page.goto(TOUR_URL);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(/\/onboarding\/tour\/avatar/, { timeout: 10000 });
    });

    test('preserves redirect query param — voice with redirect=summary goes to /onboarding/tour/audio?redirect=summary', async ({ page }) => {
      await setupPage(page, 'voice');
      await page.goto(`${TOUR_URL}?redirect=summary`);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(
        /\/onboarding\/tour\/audio.*redirect=summary/,
        { timeout: 10000 }
      );
    });

    test('preserves redirect query param — avatar with redirect=summary goes to /onboarding/tour/avatar?redirect=summary', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(`${TOUR_URL}?redirect=summary`);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(
        /\/onboarding\/tour\/avatar.*redirect=summary/,
        { timeout: 10000 }
      );
    });

    test('preserves redirect query param — text with redirect=summary goes to /onboarding/tour/text?redirect=summary', async ({ page }) => {
      await setupPage(page, 'text');
      await page.goto(`${TOUR_URL}?redirect=summary`);

      await expect(takeTourCard(page)).toBeVisible({ timeout: 10000 });
      await takeTourCard(page).click();

      await expect(page).toHaveURL(
        /\/onboarding\/tour\/text.*redirect=summary/,
        { timeout: 10000 }
      );
    });
  });

  test.describe('Secondary CTA', () => {
    test('"Do it later" navigates to /dashboard', async ({ page }) => {
      await setupPage(page, 'avatar');
      await page.goto(TOUR_URL);

      await expect(doItLaterCard(page)).toBeVisible({ timeout: 10000 });
      await doItLaterCard(page).click();

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });
  });
});
