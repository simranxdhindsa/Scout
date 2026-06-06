/**
 * Onboarding — Preference page (E2E flow spec).
 *
 * Scope: behaviors only a real browser + real backend can verify for
 * /onboarding/preference. The page itself ships no getServerSideProps guard;
 * the meaningful E2E assertions are:
 *   - the user's existing learning_preference is restored from the real
 *     /onboarding/user-preferences response on load (UX regression target)
 *   - "Continue" PATCHes /user/profile against the real backend and the
 *     resulting redirect goes to /onboarding/tour
 *
 * Pure UI branches (card "selected" styling, gradient title, dummy chat
 * preview) belong in tests/onboarding/preference.spec.ts with mocks.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD                       — global-setup
 *
 * Optional (each unlocks one real-flow test):
 *   TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW  — onboarding
 *     incomplete user that can reach /onboarding/preference after picking an
 *     avatar OR navigating directly when client-side auth permits.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PREFERENCE_URL = '/onboarding/preference';
const PREFERENCE_URL_RE = /\/onboarding\/preference/;
const TOUR_URL_RE = /\/onboarding\/tour(\?|$|\/)/;
const LOGIN_URL = '/auth/signIn';

const env = {
  onboardingNewEmail: process.env.TEST_EMAIL_ONBOARDING_NEW ?? '',
  onboardingNewPassword: process.env.TEST_PASSWORD_ONBOARDING_NEW ?? '',
};

const SEL = {
  emailInput: '[data-test="email-input"]',
  passwordInput: '[data-test="password-input"]',
};

const TXT = {
  signInBtn: 'Sign In',
  signInWithEmailBtn: 'Sign in with Email',
  avatarMode: 'Avatar mode',
  audioMode: 'Audio',
  textMode: 'Text only',
  continueBtn: 'Continue',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const emailInput = (p: Page) => p.locator(SEL.emailInput);
const passwordInput = (p: Page) => p.locator(SEL.passwordInput);
const signInBtn = (p: Page) => p.getByRole('button', { name: TXT.signInBtn, exact: true });
const signInWithEmailBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.signInWithEmailBtn, exact: true });
const continueBtn = (p: Page) => p.getByRole('button', { name: TXT.continueBtn, exact: true });

// The mode picker renders three Mantine Cards. Only the Cards carry
// aria-pressed (Preference.tsx:106), so we use that attribute to scope —
// otherwise a `div` filter also matches the wrapping container that holds
// all three cards, and clicks land on the wrong one.
const modeCard = (p: Page, title: string) =>
  p.locator('[aria-pressed]').filter({ hasText: title });

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
  // The page reads /onboarding/user-preferences to hydrate the default mode
  // selection. Anchor on the request so subsequent assertions don't race the
  // hydration effect in Preference.tsx:21-23.
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
// 1. Smoke
// ===========================================================================
test.describe('Smoke', () => {
  test('unauthenticated GET /onboarding/preference is redirected to /auth/signIn with callback_url preserved', async ({
    page,
  }) => {
    // The page itself has no getServerSideProps guard, but Edge middleware
    // (ui/src/middleware.ts) enforces session-cookie presence on every
    // non-public path and redirects to /auth/signIn?callback_url=<original>.
    // Pinning that contract here so a change to the middleware's
    // PUBLIC_PREFIXES list is a deliberate decision, not an accident.
    await page.goto(PREFERENCE_URL);
    await expect(page).toHaveURL(
      /\/auth\/signIn\?callback_url=%2Fonboarding%2Fpreference/,
      { timeout: 10000 }
    );
  });
});

// ===========================================================================
// 2. Real-backend flow — preference selection routes to tour
// ===========================================================================
test.describe('Real backend — submit', () => {
  test('selecting a mode and clicking Continue PATCHes the profile and navigates to /onboarding/tour', async ({
    page,
  }) => {
    test.skip(
      !env.onboardingNewEmail || !env.onboardingNewPassword,
      'TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW required (seed a user that can reach /onboarding/preference)'
    );

    await loginWith(page, env.onboardingNewEmail, env.onboardingNewPassword);

    // Navigate explicitly — the user may have landed elsewhere depending on
    // their progress through onboarding. This test cares about the page in
    // isolation, not the post-login routing (covered in login.spec.ts).
    // Register the hydration listener BEFORE goto, otherwise webkit can
    // resolve the response during navigation and the listener attaches late.
    const userPrefLoaded = waitForUserPreferenceLoaded(page);
    await page.goto(PREFERENCE_URL);
    await userPrefLoaded;

    // Click the "Text only" card so the selection is unambiguous regardless
    // of the user's existing preference.
    await modeCard(page, TXT.textMode).click();

    const patchResponse = page.waitForResponse(
      (res) =>
        /\/o\/user\/profile(\?|$)/.test(res.url()) &&
        res.request().method() === 'PATCH' &&
        res.status() < 400,
      { timeout: 20000 }
    );
    await continueBtn(page).click();
    const res = await patchResponse;

    // Verify the request body carried the selection — proves the UI is wired
    // to the source's selectedMode state and didn't ship a stale default.
    const body = res.request().postDataJSON();
    expect(body?.learning_mode_preference).toBe('text');

    await expect(page).toHaveURL(TOUR_URL_RE, { timeout: 20000 });
  });

  test('redirect=summary param routes back to /onboarding/tour/<mode>?redirect=summary after submit', async ({
    page,
  }) => {
    // Source: Preference.tsx:59-67. When the user reaches this page from the
    // summary edit flow, submit must route to the mode-specific tour with
    // redirect=summary preserved.
    test.skip(
      !env.onboardingNewEmail || !env.onboardingNewPassword,
      'TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW required'
    );

    await loginWith(page, env.onboardingNewEmail, env.onboardingNewPassword);

    const userPrefLoaded = waitForUserPreferenceLoaded(page);
    await page.goto(`${PREFERENCE_URL}?redirect=summary`);
    await userPrefLoaded;

    await modeCard(page, TXT.audioMode).click();

    const patchResponse = page.waitForResponse(
      (res) =>
        /\/o\/user\/profile(\?|$)/.test(res.url()) &&
        res.request().method() === 'PATCH' &&
        res.status() < 400,
      { timeout: 20000 }
    );
    await continueBtn(page).click();
    await patchResponse;

    // 'voice' → 'audio' route per routeMap in Preference.tsx:61-65.
    await expect(page).toHaveURL(/\/onboarding\/tour\/audio\?redirect=summary/, {
      timeout: 20000,
    });
  });
});
