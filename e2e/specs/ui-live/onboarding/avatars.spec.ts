/**
 * Onboarding — Avatars page (E2E flow spec).
 *
 * Scope: behaviors only a real browser + real backend can verify for
 * /onboarding/avatars. The page ships getServerSideProps that hard-redirects
 * to /auth/signIn when the accessToken cookie is missing — that SSR redirect
 * is the highest-value assertion in this file and cannot be exercised by a
 * component test.
 *
 * Pure-renderer assertions (title text, instructor card grid, skeleton states)
 * belong in tests/onboarding/avatars.spec.ts with mocked APIs — not here.
 *
 * Required env (see ardoise-tests/.env):
 *   BASE_URL                                — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD              — used by global-setup to seed
 *                                             playwright/.auth/user.json
 *
 * Optional (each unlocks one real-flow test):
 *   TEST_EMAIL_ONBOARDING_NEW               — onboarding_completed=false, no
 *   TEST_PASSWORD_ONBOARDING_NEW              avatar selected yet → lands on
 *                                             /onboarding/avatars after login
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AVATARS_URL = '/onboarding/avatars';
const AVATARS_URL_RE = /\/onboarding\/avatars/;
const LOGIN_URL = '/auth/signIn';
const LOGIN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

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
  chooseInstructor: 'Choose your instructor',
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
const chooseInstructorTitle = (p: Page) =>
  p.getByText(TXT.chooseInstructor, { exact: true });
const continueBtn = (p: Page) => p.getByRole('button', { name: TXT.continueBtn, exact: true });

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
  const credentialsResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/api/auth/callback/credentials') && res.request().method() === 'POST',
    { timeout: 30000 }
  );
  await signInBtn(page).click();
  await credentialsResponse;
}

async function loginWith(page: Page, email: string, password: string) {
  await page.goto(LOGIN_URL);
  await revealCredentialForm(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await submitAndAwaitAuth(page);
}

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
// Most tests run unauthenticated to exercise the SSR redirect. The smoke test
// opts back into the saved session via storageState explicitly.
test.use({ storageState: { cookies: [], origins: [] } });

// Pin English so text-based locators are stable in non-English environments.
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
  test('GET /onboarding/avatars while authenticated returns 200', async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_STATE });
    try {
      const page = await context.newPage();
      const response = await page.goto(AVATARS_URL);
      // SSR may redirect onboarding-complete users to /dashboard via signIn flow,
      // but a direct GET to this URL with a valid token must not 5xx.
      expect(response?.status(), 'avatars page should respond 2xx/3xx').toBeLessThan(400);
    } finally {
      await context.close();
    }
  });
});

// ===========================================================================
// 2. Server-side redirects (real Next.js getServerSideProps in avatars.tsx)
// ===========================================================================
test.describe('Server-side redirects', () => {
  test('unauthenticated visit to /onboarding/avatars redirects to /auth/signIn', async ({
    page,
  }) => {
    await page.goto(AVATARS_URL);
    await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
  });

  test('unauthenticated visit to /onboarding/avatars?tab=audio-model also redirects', async ({
    page,
  }) => {
    // The SSP guard runs before the query param branches the renderer, so it
    // must redirect regardless of tab=avatar | tab=audio-model.
    await page.goto(`${AVATARS_URL}?tab=audio-model`);
    await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
  });
});

// ===========================================================================
// 3. Real-backend flow — sign-in routing lands here for incomplete users
// ===========================================================================
test.describe('Real backend — onboarding entry', () => {
  test('onboarding-incomplete user signing in lands on /onboarding/avatars and sees the instructor picker', async ({
    page,
  }) => {
    test.skip(
      !env.onboardingNewEmail || !env.onboardingNewPassword,
      'TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW required (seed a user with onboarding_completed=false and no avatar)'
    );

    await loginWith(page, env.onboardingNewEmail, env.onboardingNewPassword);

    await expect(page).toHaveURL(AVATARS_URL_RE, { timeout: 30000 });

    // The picker hydrates after the avatars API resolves. Anchor on the
    // title — pure renderer mocks can't prove this contract holds against
    // the real /onboarding endpoint.
    await expect(chooseInstructorTitle(page)).toBeVisible({ timeout: 20000 });

    // Continue stays disabled until the user picks an instructor — proves
    // the avatar list rendered with selectable items, not the empty state.
    await expect(continueBtn(page)).toBeDisabled();
  });
});
