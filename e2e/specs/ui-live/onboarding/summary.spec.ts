/**
 * Onboarding — Summary page (E2E flow spec).
 *
 * Scope: behaviors only a real browser + real backend can verify for
 * /onboarding/summary. Two assertions earn their place here:
 *   1. "Validate & Start Learning" PUTs the real /onboarding/complete endpoint
 *      and lands the user on /dashboard — the final write of the entire
 *      onboarding pipeline.
 *   2. The "Edit" buttons preserve the redirect=summary query param into the
 *      target page so the user is returned to summary after editing.
 *
 * Pure layout assertions (skeleton, instructor card, interests pill rendering)
 * belong in tests/onboarding/summary.spec.ts with mocked APIs.
 *
 * Required env:
 *   BASE_URL, TEST_EMAIL, TEST_PASSWORD                            — global-setup
 *
 * Optional:
 *   TEST_EMAIL_ONBOARDING_READY / TEST_PASSWORD_ONBOARDING_READY   — incomplete
 *     user whose onboarding state is far enough along to render /summary
 *     (avatar picked, audio model picked, learning preference set, interests
 *     present). Without this, the start-learning assertion is skipped because
 *     a fully-onboarded user would already have been redirected to /dashboard
 *     and a too-early user has a skeleton-only page.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SUMMARY_URL = '/onboarding/summary';
const SUMMARY_URL_RE = /\/onboarding\/summary/;
const LOGIN_URL = '/auth/signIn';
const DASHBOARD_URL_RE = /\/dashboard(\?|$|\/)/;

const env = {
  summaryReadyEmail: process.env.TEST_EMAIL_ONBOARDING_READY ?? '',
  summaryReadyPassword: process.env.TEST_PASSWORD_ONBOARDING_READY ?? '',
};

const SEL = {
  emailInput: '[data-test="email-input"]',
  passwordInput: '[data-test="password-input"]',
};

const TXT = {
  signInBtn: 'Sign In',
  signInWithEmailBtn: 'Sign in with Email',
  startLearning: 'Validate & Start Learning',
  edit: 'Edit',
  instructorLabel: 'YOUR INSTRUCTOR',
  voiceLabel: 'VOICE PREFERENCE',
  commsLabel: 'Communication Preferences',
  interestsLabel: 'YOUR INTERESTS',
  goalsLabel: 'YOUR LEARNING GOALS',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const emailInput = (p: Page) => p.locator(SEL.emailInput);
const passwordInput = (p: Page) => p.locator(SEL.passwordInput);
const signInBtn = (p: Page) => p.getByRole('button', { name: TXT.signInBtn, exact: true });
const signInWithEmailBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.signInWithEmailBtn, exact: true });
const startLearningBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.startLearning, exact: true });

// Each summary card renders one Edit button; scope by the section label.
// .mantine-Card-root is the stable wrapper class per Mantine v6.
const cardByLabel = (p: Page, label: string) =>
  p.locator('.mantine-Card-root').filter({ hasText: label });

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
// 1. Smoke
// ===========================================================================
test.describe('Smoke', () => {
  test('unauthenticated GET /onboarding/summary is redirected to /auth/signIn with callback_url preserved', async ({
    page,
  }) => {
    // The page has no getServerSideProps guard, but Edge middleware
    // (ui/src/middleware.ts) enforces session-cookie presence on every
    // non-public path. Pinning that contract here so a change to the
    // middleware's PUBLIC_PREFIXES list is a deliberate decision.
    await page.goto(SUMMARY_URL);
    await expect(page).toHaveURL(
      /\/auth\/signIn\?callback_url=%2Fonboarding%2Fsummary/,
      { timeout: 10000 }
    );
  });
});

// ===========================================================================
// 2. Real-backend flow — complete onboarding
// ===========================================================================
test.describe('Real backend — complete onboarding', () => {
  test('"Validate & Start Learning" PUTs /onboarding/complete and navigates to /dashboard', async ({
    page,
  }) => {
    test.skip(
      !env.summaryReadyEmail || !env.summaryReadyPassword,
      'TEST_EMAIL_ONBOARDING_READY / TEST_PASSWORD_ONBOARDING_READY required (seed an incomplete user whose summary page renders — avatar, audio model, preference and interests already set on the backend)'
    );

    await loginWith(page, env.summaryReadyEmail, env.summaryReadyPassword);
    await page.goto(SUMMARY_URL);
    await waitForUserPreferenceLoaded(page);

    // Verify the page rendered past its skeleton state — the start-learning
    // button is only mounted after the preferences hydrate.
    await expect(startLearningBtn(page)).toBeVisible({ timeout: 15000 });
    await expect(startLearningBtn(page)).toBeEnabled();

    const completeResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/o/user/onboarding/complete') &&
        res.request().method() === 'PUT' &&
        res.status() < 400,
      { timeout: 20000 }
    );
    await startLearningBtn(page).click();
    await completeResponse;

    await expect(page).toHaveURL(DASHBOARD_URL_RE, { timeout: 30000 });
  });
});

// ===========================================================================
// 3. Real-backend flow — edit links preserve redirect=summary
// ===========================================================================
// The summary's Edit buttons rely on `redirect=summary` being honored by the
// downstream pages. The downstream-side handling lives in preference/avatars/
// tour code paths and is unit-testable, but only a real navigation proves
// the URLs the source emits actually carry the param end-to-end.
test.describe('Real backend — edit affordances preserve redirect=summary', () => {
  test('Edit instructor → /onboarding/avatars?redirect=summary', async ({ page }) => {
    test.skip(
      !env.summaryReadyEmail || !env.summaryReadyPassword,
      'TEST_EMAIL_ONBOARDING_READY / TEST_PASSWORD_ONBOARDING_READY required'
    );

    await loginWith(page, env.summaryReadyEmail, env.summaryReadyPassword);
    await page.goto(SUMMARY_URL);
    await waitForUserPreferenceLoaded(page);

    await cardByLabel(page, TXT.instructorLabel)
      .getByRole('button', { name: TXT.edit, exact: true })
      .click();

    await expect(page).toHaveURL(/\/onboarding\/avatars\?redirect=summary/, { timeout: 15000 });
  });

  test('Edit communication preference → /onboarding/preference?redirect=summary', async ({
    page,
  }) => {
    test.skip(
      !env.summaryReadyEmail || !env.summaryReadyPassword,
      'TEST_EMAIL_ONBOARDING_READY / TEST_PASSWORD_ONBOARDING_READY required'
    );

    await loginWith(page, env.summaryReadyEmail, env.summaryReadyPassword);
    await page.goto(SUMMARY_URL);
    await waitForUserPreferenceLoaded(page);

    await cardByLabel(page, TXT.commsLabel)
      .getByRole('button', { name: TXT.edit, exact: true })
      .click();

    await expect(page).toHaveURL(/\/onboarding\/preference\?redirect=summary/, { timeout: 15000 });
  });

  test('Edit interests → /onboarding/tour/interests?redirect=summary', async ({ page }) => {
    test.skip(
      !env.summaryReadyEmail || !env.summaryReadyPassword,
      'TEST_EMAIL_ONBOARDING_READY / TEST_PASSWORD_ONBOARDING_READY required'
    );

    await loginWith(page, env.summaryReadyEmail, env.summaryReadyPassword);
    await page.goto(SUMMARY_URL);
    await waitForUserPreferenceLoaded(page);

    await cardByLabel(page, TXT.interestsLabel)
      .getByRole('button', { name: TXT.edit, exact: true })
      .click();

    await expect(page).toHaveURL(/\/onboarding\/tour\/interests\?redirect=summary/, {
      timeout: 15000,
    });
  });

  test('Edit voice preference → /onboarding/avatars?tab=audio-model&redirect=summary', async ({
    page,
  }) => {
    // Source: summary.tsx:127-130 builds avatarId=<uuid>&redirect=summary.
    // Assert only the stable bits — the uuid varies per fixture.
    test.skip(
      !env.summaryReadyEmail || !env.summaryReadyPassword,
      'TEST_EMAIL_ONBOARDING_READY / TEST_PASSWORD_ONBOARDING_READY required'
    );

    await loginWith(page, env.summaryReadyEmail, env.summaryReadyPassword);
    await page.goto(SUMMARY_URL);
    await waitForUserPreferenceLoaded(page);

    await cardByLabel(page, TXT.voiceLabel)
      .getByRole('button', { name: TXT.edit, exact: true })
      .click();

    await expect(page).toHaveURL(
      /\/onboarding\/avatars\?tab=audio-model&avatarId=[^&]+&redirect=summary/,
      { timeout: 15000 }
    );
  });
});
