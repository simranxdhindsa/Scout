/**
 * Onboarding — Tour landing page (E2E flow spec).
 *
 * Scope: behaviors only a real browser + real backend can verify for
 * /onboarding/tour. The page ships getServerSideProps that hard-redirects
 * unauthenticated users to /auth/signIn — that's the highest-value real-
 * browser assertion here.
 *
 * Also covered (real-backend only):
 *   - "Take a tour" routes to /onboarding/tour/<mode> derived from the user's
 *     learning_preference on the live /onboarding/user-preferences response
 *   - "Do it later" bails out to /dashboard
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD                            — global-setup
 *
 * Optional:
 *   TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW       — incomplete
 *     user whose preferences default to learning_preference='avatar' (or whose
 *     mode hasn't been picked → falls back to 'avatar' in Tour.tsx:25-28)
 *
 *   TEST_EMAIL_ONBOARDING_WITH_MODE / TEST_PASSWORD_ONBOARDING_WITH_MODE
 *     — incomplete user with learning_mode_preference set; used to confirm
 *     the routeMap branches to the right /onboarding/tour/<mode> page.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOUR_URL = '/onboarding/tour';
const TOUR_URL_RE = /\/onboarding\/tour(\?|$|\/)/;
const LOGIN_URL = '/auth/signIn';
const LOGIN_URL_RE = /\/auth\/signIn/;
const DASHBOARD_URL_RE = /\/dashboard(\?|$|\/)/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  onboardingNewEmail: process.env.TEST_EMAIL_ONBOARDING_NEW ?? '',
  onboardingNewPassword: process.env.TEST_PASSWORD_ONBOARDING_NEW ?? '',
  onboardingWithModeEmail: process.env.TEST_EMAIL_ONBOARDING_WITH_MODE ?? '',
  onboardingWithModePassword: process.env.TEST_PASSWORD_ONBOARDING_WITH_MODE ?? '',
};

const SEL = {
  emailInput: '[data-test="email-input"]',
  passwordInput: '[data-test="password-input"]',
};

const TXT = {
  signInBtn: 'Sign In',
  signInWithEmailBtn: 'Sign in with Email',
  takeATourBtn: 'Take a tour & get to know each other',
  doItLater: 'Do it later',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const emailInput = (p: Page) => p.locator(SEL.emailInput);
const passwordInput = (p: Page) => p.locator(SEL.passwordInput);
const signInBtn = (p: Page) => p.getByRole('button', { name: TXT.signInBtn, exact: true });
const signInWithEmailBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.signInWithEmailBtn, exact: true });
const takeATourText = (p: Page) => p.getByText(TXT.takeATourBtn, { exact: true });
const doItLaterText = (p: Page) => p.getByText(TXT.doItLater, { exact: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function revealCredentialForm(page: Page) {
  const gate = signInWithEmailBtn(page);
  const email = emailInput(page);
  await Promise.race([
    gate.waitFor({ state: 'visible', timeout: 15000 }),
    email.waitFor({ state: 'visible', timeout: 15000 }),
  ]);
  if (await gate.isVisible()) await gate.click();
  await expect(email).toBeVisible();
}

async function submitAndAwaitAuth(page: Page) {
  // Wait for: (1) URL leaves /auth/signIn, then (2) the post-login redirect
  // chain settles. Without (2), webkit aborts any subsequent page.goto() with
  // "Navigation interrupted by another navigation" because the app's
  // client-side post-login router is still firing.
  await signInBtn(page).click();
  await page.waitForURL((url) => !/\/auth\/signIn/.test(url.pathname), { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

async function loginWith(page: Page, email: string, password: string) {
  await page.goto(LOGIN_URL);
  await revealCredentialForm(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await submitAndAwaitAuth(page);
}

async function waitForUserPreferenceLoaded(page: Page) {
  await page.waitForResponse(
    (res) =>
      res.url().includes('/onboarding/user-preferences') &&
      res.request().method() === 'GET' &&
      res.status() === 200,
    { timeout: 20000 }
  );
}

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) return;
  await context.addCookies([
    {
      name: 'userSelectedLanguage',
      value: 'en',
      domain: new URL(baseURL).hostname,
      path: '/',
    },
  ]);
});

// ===========================================================================
// 1. Server-side redirects
// ===========================================================================
test.describe('Server-side redirects', () => {
  test('unauthenticated visit to /onboarding/tour redirects to /auth/signIn', async ({ page }) => {
    await page.goto(TOUR_URL);
    await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
  });
});

// ===========================================================================
// 2. Real-backend flow — page actions
// ===========================================================================
test.describe('Real backend — tour actions', () => {
  test('clicking "Do it later" navigates to /dashboard', async ({ page }) => {
    test.skip(
      !env.onboardingNewEmail || !env.onboardingNewPassword,
      'TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW required (the do-it-later affordance exists for incomplete users; logged in via fresh sign-in to bypass post-login routing)'
    );

    await loginWith(page, env.onboardingNewEmail, env.onboardingNewPassword);
    // Navigate to /onboarding/tour explicitly — post-login routing may have
    // sent the user elsewhere depending on their progress.
    await page.goto(TOUR_URL);

    await expect(doItLaterText(page)).toBeVisible({ timeout: 15000 });
    await doItLaterText(page).click();

    await expect(page).toHaveURL(DASHBOARD_URL_RE, { timeout: 20000 });
  });

  test('clicking "Take a tour" routes to /onboarding/tour/<mode> based on the user\'s learning_preference', async ({
    page,
  }) => {
    test.skip(
      !env.onboardingWithModeEmail || !env.onboardingWithModePassword,
      'TEST_EMAIL_ONBOARDING_WITH_MODE / TEST_PASSWORD_ONBOARDING_WITH_MODE required (seed an incomplete user with learning_mode_preference set)'
    );

    await loginWith(page, env.onboardingWithModeEmail, env.onboardingWithModePassword);
    // Register the hydration listener BEFORE goto — webkit can resolve the
    // response during navigation, so a post-goto listener attaches too late.
    const prefRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/onboarding/user-preferences') &&
        res.request().method() === 'GET' &&
        res.status() === 200,
      { timeout: 20000 }
    );
    await page.goto(TOUR_URL);
    const prefResp = await prefRespPromise;

    // Decode the live preference from the real response — the test asserts the
    // routeMap contract (Tour.tsx:18-30) against whatever the seeded user is,
    // rather than hardcoding one mode. This keeps the test honest if backend
    // seeding shifts.
    const body = await prefResp.json();
    const learningPref = body?.data?.learning_preference as 'avatar' | 'voice' | 'text' | undefined;
    const expectedRoute = { avatar: 'avatar', voice: 'audio', text: 'text' }[
      learningPref ?? 'avatar'
    ];

    await expect(takeATourText(page)).toBeVisible({ timeout: 15000 });
    await takeATourText(page).click();

    await expect(page).toHaveURL(new RegExp(`/onboarding/tour/${expectedRoute}(\\?|$|/)`), {
      timeout: 20000,
    });
  });
});

// ===========================================================================
// 3. Smoke — page renders with the saved session
// ===========================================================================
test.describe('Smoke', () => {
  test('authenticated GET /onboarding/tour returns 200', async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_STATE });
    try {
      const page = await context.newPage();
      const response = await page.goto(TOUR_URL);
      expect(response?.status(), 'tour page must not 5xx for an authed user').toBeLessThan(400);
    } finally {
      await context.close();
    }
  });
});
