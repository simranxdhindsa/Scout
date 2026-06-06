/**
 * Login — E2E flow spec.
 *
 * Scope: only behaviors that nothing other than a real browser + real backend
 * can verify. UI-rendering branches that only depend on a mocked API shape
 * belong in component tests, not here.
 *
 * Most real-flow tests are gated on environment variables that map to seeded
 * backend users. A test is skipped (with a clear reason) when its fixture
 * isn't configured, so the suite stays green during gradual rollout.
 *
 * Required env (see ardoise-tests/.env):
 *   BASE_URL                          — deployed app under test
 *   TEST_EMAIL / TEST_PASSWORD        — fully onboarded user → /dashboard
 *
 * Optional (each unlocks one real-flow test):
 *   TEST_EMAIL_ONBOARDING_NEW         — onboarding_completed=false, no learning_mode
 *   TEST_PASSWORD_ONBOARDING_NEW      → expects /onboarding/avatars
 *
 *   TEST_EMAIL_ONBOARDING_WITH_MODE   — onboarding_completed=false, has learning_mode
 *   TEST_PASSWORD_ONBOARDING_WITH_MODE→ expects /onboarding/tour
 *
 *   TEST_EMAIL_LOCKED                 — locked account
 *   TEST_PASSWORD_LOCKED              → expects "Your account is locked" alert
 *
 *   INVALID_TEST_USER_EMAIL / INVALID_TEST_USER_PASSWORD — wrong creds
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LOGIN_URL = '/auth/signIn';
const LOGIN_URL_RE = /\/auth\/signIn/;
const AUTH_STATE = 'playwright/.auth/user.json';

const env = {
  validEmail: process.env.TEST_EMAIL ?? '',
  validPassword: process.env.TEST_PASSWORD ?? '',
  invalidEmail: process.env.INVALID_TEST_USER_EMAIL ?? 'nope@example.com',
  invalidPassword: process.env.INVALID_TEST_USER_PASSWORD ?? 'WrongPassw0rd!',
  onboardingNewEmail: process.env.TEST_EMAIL_ONBOARDING_NEW ?? '',
  onboardingNewPassword: process.env.TEST_PASSWORD_ONBOARDING_NEW ?? '',
  onboardingWithModeEmail: process.env.TEST_EMAIL_ONBOARDING_WITH_MODE ?? '',
  onboardingWithModePassword: process.env.TEST_PASSWORD_ONBOARDING_WITH_MODE ?? '',
  lockedEmail: process.env.TEST_EMAIL_LOCKED ?? '',
  lockedPassword: process.env.TEST_PASSWORD_LOCKED ?? '',
};

const SEL = {
  emailInput: '[data-test="email-input"]',
  passwordInput: '[data-test="password-input"]',
  errorAlert: '[data-test="login-error-alert"]',
};

const TXT = {
  signInBtn: 'Sign In',
  signInWithEmailBtn: 'Sign in with Email',
  forgotPassword: 'Forgot Password?',
  sessionExpired: 'Your session has expired.',
  somethingWentWrong: 'Something went wrong!',
  accountLocked: 'Your account is locked',
};

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const emailInput = (p: Page) => p.locator(SEL.emailInput);
const passwordInput = (p: Page) => p.locator(SEL.passwordInput);
const errorAlert = (p: Page) => p.locator(SEL.errorAlert);
const submitButton = (p: Page) =>
  p.getByRole('button', { name: TXT.signInBtn, exact: true });
const signInWithEmailBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.signInWithEmailBtn, exact: true });
const forgotPasswordLink = (p: Page) =>
  p.getByRole('link', { name: TXT.forgotPassword });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Reveals the credential form whether the page boots in direct mode or
 * SSO-enabled mode. Races the two states with waitFor — isVisible() snapshots
 * the current moment and misses the first paint.
 */
async function revealCredentialForm(page: Page): Promise<void> {
  const gate = signInWithEmailBtn(page);
  const email = emailInput(page);

  await Promise.race([
    gate.waitFor({ state: 'visible', timeout: 15000 }),
    email.waitFor({ state: 'visible', timeout: 15000 }),
  ]);

  if (await gate.isVisible()) {
    await gate.click();
  }
  await expect(email).toBeVisible();
}

/**
 * Submits the login form and waits for auth to resolve. We anchor on the
 * observable outcome (URL leaves /auth/signIn OR the error alert renders)
 * rather than a specific NextAuth endpoint — provider id / basePath can vary
 * by deployment, and signIn.tsx:254 clears `error` at submit start so a naive
 * DOM check would race the cleared state.
 */
async function submitAndAwaitAuth(page: Page): Promise<void> {
  await submitButton(page).click();
  await Promise.race([
    page.waitForURL((url) => !LOGIN_URL_RE.test(url.pathname), { timeout: 30000 }),
    errorAlert(page).waitFor({ state: 'visible', timeout: 30000 }),
  ]);
}

async function loginWith(page: Page, email: string, password: string): Promise<void> {
  await page.goto(LOGIN_URL);
  await revealCredentialForm(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await submitAndAwaitAuth(page);
}

/**
 * Runs a single login flow in a fresh unauthenticated context, starting from
 * a URL that may carry query params (callback_url, source, etc.).
 */
async function withFreshLogin(
  page: Page,
  startUrl: string,
  email: string,
  password: string
): Promise<void> {
  await page.goto(startUrl);
  await revealCredentialForm(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await submitAndAwaitAuth(page);
}

// ---------------------------------------------------------------------------
// File-scope state
// ---------------------------------------------------------------------------
// Every test runs unauthenticated. The auth-state tests opt back in by
// creating a context with the storageState file.
test.use({ storageState: { cookies: [], origins: [] } });

// The deployed test environment defaults to French. Pin to English via the
// cookie src/i18n.ts:24 reads at boot, so text-based locators are stable.
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
  test('GET /auth/signIn returns 200', async ({ page }) => {
    const response = await page.goto(LOGIN_URL);
    expect(response?.status()).toBe(200);
  });
});

// ===========================================================================
// 2. Real-backend flows — what users actually do
// ===========================================================================
test.describe('Real backend — login flows', () => {
  test('valid credentials authenticate the user (lands off /auth/signIn)', async ({ page }) => {
    // Broad assertion — works regardless of the TEST_EMAIL user's onboarding
    // state. The strict "lands on /dashboard" test below requires a
    // fully-onboarded fixture user and is env-gated separately.
    test.skip(!env.validEmail || !env.validPassword, 'TEST_EMAIL / TEST_PASSWORD required');

    await loginWith(page, env.validEmail, env.validPassword);
    await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 30000 });
  });

  test('fully-onboarded user lands specifically on /dashboard', async ({ page }) => {
    const email = process.env.TEST_EMAIL_DASHBOARD ?? '';
    const password = process.env.TEST_PASSWORD_DASHBOARD ?? '';
    test.skip(
      !email || !password,
      'TEST_EMAIL_DASHBOARD / TEST_PASSWORD_DASHBOARD required (seed a fully-onboarded user — TEST_EMAIL in this env is onboarding-incomplete)'
    );

    await loginWith(page, email, password);
    await expect(page).toHaveURL(/\/dashboard(\?|$|\/)/, { timeout: 30000 });
  });

  test('invalid credentials surface the error alert and stay on /auth/signIn', async ({
    page,
  }) => {
    await loginWith(page, env.invalidEmail, env.invalidPassword);

    await expect(errorAlert(page)).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(LOGIN_URL_RE);
  });

  test('locked account surfaces the "Your account is locked" alert', async ({ page }) => {
    test.skip(
      !env.lockedEmail || !env.lockedPassword,
      'TEST_EMAIL_LOCKED / TEST_PASSWORD_LOCKED required (seed a locked account on the backend)'
    );

    await loginWith(page, env.lockedEmail, env.lockedPassword);

    const alert = errorAlert(page);
    await expect(alert).toBeVisible({ timeout: 20000 });
    await expect(alert).toContainText(TXT.accountLocked);
  });
});

// ===========================================================================
// 3. Real-backend flows — post-login routing branches (signIn.tsx:289-333)
// ===========================================================================
test.describe('Real backend — post-login routing', () => {
  test('new user with onboarding incomplete is routed to /onboarding/avatars', async ({
    page,
  }) => {
    test.skip(
      !env.onboardingNewEmail || !env.onboardingNewPassword,
      'TEST_EMAIL_ONBOARDING_NEW / TEST_PASSWORD_ONBOARDING_NEW required (seed a user with onboarding_completed=false, no learning_mode_preference cookie)'
    );

    await withFreshLogin(page, LOGIN_URL, env.onboardingNewEmail, env.onboardingNewPassword);

    await expect(page).toHaveURL(/\/onboarding\/avatars/, { timeout: 30000 });
  });

  test('user with learning_mode_preference but onboarding incomplete is routed to /onboarding/tour', async ({
    page,
  }) => {
    test.skip(
      !env.onboardingWithModeEmail || !env.onboardingWithModePassword,
      'TEST_EMAIL_ONBOARDING_WITH_MODE / TEST_PASSWORD_ONBOARDING_WITH_MODE required (seed a user with onboarding_completed=false AND learning_mode_preference set)'
    );

    await withFreshLogin(
      page,
      LOGIN_URL,
      env.onboardingWithModeEmail,
      env.onboardingWithModePassword
    );

    await expect(page).toHaveURL(/\/onboarding\/tour/, { timeout: 30000 });
  });

  test('safe callback_url is honored after successful login', async ({ page }) => {
    // Needs a fully-onboarded user — onboarding-incomplete users are routed
    // to /onboarding/* regardless of callback_url (source: signIn.tsx:321-328).
    const email = process.env.TEST_EMAIL_DASHBOARD ?? '';
    const password = process.env.TEST_PASSWORD_DASHBOARD ?? '';
    test.skip(
      !email || !password,
      'TEST_EMAIL_DASHBOARD / TEST_PASSWORD_DASHBOARD required (fully-onboarded user)'
    );

    await withFreshLogin(page, `${LOGIN_URL}?callback_url=/bookmark`, email, password);
    await expect(page).toHaveURL(/\/bookmark(\?|$|\/)/, { timeout: 30000 });
  });

  test('unsafe callback_url pointing back at /auth/* is rejected', async ({ page }) => {
    // Source guard: signIn.tsx:312-315 — !callback_url.startsWith('/auth/').
    // The destination depends on the user's onboarding state; what we assert
    // here is that the unsafe callback was IGNORED (user did not bounce back
    // to /auth/signIn).
    test.skip(!env.validEmail || !env.validPassword, 'TEST_EMAIL / TEST_PASSWORD required');

    await withFreshLogin(
      page,
      `${LOGIN_URL}?callback_url=/auth/signIn`,
      env.validEmail,
      env.validPassword
    );

    await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 30000 });
  });
});

// ===========================================================================
// 4. Server-side redirects (real Next.js getServerSideProps)
// ===========================================================================
test.describe('Server-side redirects', () => {
  test('unauthenticated visit to a protected route redirects to /auth/signIn', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
  });

  test('authenticated user opening /auth/signIn is redirected away', async ({ browser }) => {
    test.skip(
      !env.validEmail || !env.validPassword,
      'TEST_EMAIL / TEST_PASSWORD required to populate playwright/.auth/user.json'
    );

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();
    await page.goto(LOGIN_URL);
    await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
    await context.close();
  });

  test('authenticated user reaches /dashboard directly', async ({ browser }) => {
    test.skip(!env.validEmail || !env.validPassword, 'TEST_EMAIL / TEST_PASSWORD required');

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
    await context.close();
  });
});

// ===========================================================================
// 5. URL-state banners (real React state, no mocks needed)
// ===========================================================================
test.describe('URL-driven banners', () => {
  test('?sessionExpired=true renders the session-expired alert', async ({ page }) => {
    await page.goto(`${LOGIN_URL}?sessionExpired=true`);
    // The alert lives inside {showCredForm && ...} — in SSO-enabled tenants
    // it isn't shown until the credential form is revealed.
    await revealCredentialForm(page);

    const alert = errorAlert(page);
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText(TXT.sessionExpired);
  });

  test('?error=<msg> renders the generic "Something went wrong!" alert', async ({ page }) => {
    await page.goto(`${LOGIN_URL}?error=CredentialsSignin`);
    await revealCredentialForm(page);

    const alert = errorAlert(page);
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText(TXT.somethingWentWrong);
  });
});

// ===========================================================================
// 6. Forgot-password navigation contract
// ===========================================================================
test.describe('Forgot password link', () => {
  test('points to /auth/password_reset', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await revealCredentialForm(page);

    const link = forgotPasswordLink(page);
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', /\/auth\/password_reset/);
  });

  test('preserves the current query string into the reset page', async ({ page }) => {
    await page.goto(`${LOGIN_URL}?callback_url=/dashboard&source=mobile`);
    await revealCredentialForm(page);

    const link = forgotPasswordLink(page);
    await expect(link).toBeVisible({ timeout: 10000 });
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(/callback_url=%2Fdashboard|callback_url=\/dashboard/);
    expect(href).toContain('source=mobile');
  });
});

// ===========================================================================
// 7. Contract canary — real IdP API
// ===========================================================================
// If this fails, every UI assumption about SSO is suspect. Hit the real
// endpoint with no mock and verify the shape signIn.tsx + SocialLogin.tsx
// actually consume.
test.describe('Contract — /api/auth/identity-providers', () => {
  test('responds with the shape the login page consumes', async ({ request }) => {
    const res = await request.post('/api/auth/identity-providers');
    expect(res.ok(), `IdP endpoint returned ${res.status()}`).toBeTruthy();

    const body = await res.json();
    expect(body, 'response must be an object').toBeTruthy();
    expect(body).toHaveProperty('data');

    const data = body.data;
    expect(typeof data.enabled, 'data.enabled must be boolean').toBe('boolean');
    expect(typeof data.sso_only, 'data.sso_only must be boolean').toBe('boolean');
    expect(Array.isArray(data.data), 'data.data must be an array of providers').toBe(true);

    // If SSO is enabled, each provider must carry the fields SocialLogin.tsx reads.
    if (data.enabled && data.data.length > 0) {
      for (const idp of data.data) {
        expect(idp).toHaveProperty('uuid');
        expect(idp).toHaveProperty('idp_alias');
        expect(idp).toHaveProperty('display_name');
      }
    }
  });
});
