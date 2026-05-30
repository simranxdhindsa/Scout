import { test, expect, Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LOGIN_URL = '/auth/signIn';
const LOGIN_URL_RE = /\/auth\/signIn/;

const VALID_EMAIL = process.env.TEST_EMAIL ?? '';
const VALID_PASSWORD = process.env.TEST_PASSWORD ?? '';
const INVALID_EMAIL = process.env.INVALID_TEST_USER_EMAIL ?? 'wrong@example.com';
const INVALID_PASSWORD = process.env.INVALID_TEST_USER_PASSWORD ?? 'WrongPassw0rd!';

// Source-of-truth selectors (signIn.tsx ships these data-test attributes).
const SEL = {
  emailInput: '[data-test="email-input"]',
  passwordInput: '[data-test="password-input"]',
  errorAlert: '[data-test="login-error-alert"]',
};

// English copy used for stable role/text-based locators. Source: src/translations/en.json.
const TXT = {
  pageTitle: 'Sign In',
  signInBtn: 'Sign In',
  signInWithEmailBtn: 'Sign in with Email',
  back: 'Back',
  forgotPassword: 'Forgot Password?',
  sessionExpired: 'Your session has expired.',
  somethingWentWrong: 'Something went wrong!',
  accountLocked: 'Your account is locked',
};

// ---------------------------------------------------------------------------
// IdP payload builders
// ---------------------------------------------------------------------------
function buildIdpResponse(
  opts: { enabled?: boolean; ssoOnly?: boolean; providers?: any[] } = {}
) {
  return {
    data: {
      enabled: opts.enabled ?? false,
      sso_only: opts.ssoOnly ?? false,
      data:
        opts.providers ??
        [
          {
            uuid: 'idp-google',
            idp_alias: 'google',
            display_name: 'Sign in with Google',
            display_name_translations: [],
            display_help: '',
            display_help_translations: [],
            display_icon: 'google',
          },
        ],
    },
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
function isApi(route: Route) {
  const t = route.request().resourceType();
  return t === 'fetch' || t === 'xhr';
}

async function mockIdp(
  page: Page,
  opts: { enabled?: boolean; ssoOnly?: boolean; providers?: any[]; status?: number } = {}
) {
  await page.route('**/api/auth/identity-providers**', async (route) => {
    if (!isApi(route)) return route.continue();
    if (opts.status && opts.status >= 400) {
      return route.fulfill({ status: opts.status, body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildIdpResponse(opts)),
    });
  });
}

// ---------------------------------------------------------------------------
// Locator factories
// ---------------------------------------------------------------------------
const emailInput = (p: Page) => p.locator(SEL.emailInput);
const passwordInput = (p: Page) => p.locator(SEL.passwordInput);
const errorAlert = (p: Page) => p.locator(SEL.errorAlert);
const submitButton = (p: Page) => p.getByRole('button', { name: TXT.signInBtn, exact: true });
const signInWithEmailBtn = (p: Page) =>
  p.getByRole('button', { name: TXT.signInWithEmailBtn, exact: true });
const backControl = (p: Page) => p.getByText(TXT.back, { exact: true });
const forgotPasswordLink = (p: Page) => p.getByRole('link', { name: TXT.forgotPassword });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function revealCredentialForm(page: Page): Promise<void> {
  // The login page renders either:
  //   - direct mode:   email + password visible immediately
  //   - SSO-enabled:   IdP buttons + "Sign in with Email" gate (the form is
  //                    hidden until the gate is clicked)
  // Race the two states with waitFor() — isVisible() snapshots the *current*
  // moment and returns false during the initial paint, so we'd miss the gate.
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

async function fillCredentials(page: Page, email: string, password: string) {
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
}

// ---------------------------------------------------------------------------
// File-scope state: every test in this file runs unauthenticated.
// ---------------------------------------------------------------------------
test.use({ storageState: { cookies: [], origins: [] } });

// The deployed test environment defaults to French. Pin every test to English
// so text-based locators are stable. src/i18n.ts:24 reads the
// `userSelectedLanguage` cookie at boot, so setting it once per test forces
// the whole UI into English without touching the URL.
test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) return;
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: 'userSelectedLanguage',
      value: 'en',
      domain: hostname,
      path: '/',
    },
  ]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Login page', () => {
  test.describe('Page load', () => {
    test('GET /auth/signIn returns 200', async ({ page }) => {
      await mockIdp(page, { enabled: false });
      const response = await page.goto(LOGIN_URL);
      expect(response?.status()).toBe(200);
    });

    test('renders the "Sign In" page title', async ({ page }) => {
      await mockIdp(page, { enabled: false });
      await page.goto(LOGIN_URL);
      await expect(
        page.getByRole('heading', { name: TXT.pageTitle, exact: true })
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Direct mode (SSO disabled)', () => {
    test.beforeEach(async ({ page }) => {
      await mockIdp(page, { enabled: false });
    });

    test('renders email + password fields and the Sign In submit button immediately', async ({
      page,
    }) => {
      await page.goto(LOGIN_URL);

      await expect(emailInput(page)).toBeVisible({ timeout: 10000 });
      await expect(passwordInput(page)).toBeVisible();
      await expect(submitButton(page)).toBeVisible();
      // "Sign in with Email" button must NOT appear when SSO is disabled.
      await expect(signInWithEmailBtn(page)).toHaveCount(0);
    });

    test('renders the forgot-password link pointing to /auth/password_reset', async ({ page }) => {
      await page.goto(LOGIN_URL);
      const link = forgotPasswordLink(page);
      await expect(link).toBeVisible({ timeout: 10000 });
      await expect(link).toHaveAttribute('href', /\/auth\/password_reset/);
    });

    test('forgot-password link preserves the current query string', async ({ page }) => {
      await page.goto(`${LOGIN_URL}?callback_url=/dashboard&source=mobile`);
      const link = forgotPasswordLink(page);
      await expect(link).toBeVisible({ timeout: 10000 });
      const href = (await link.getAttribute('href')) ?? '';
      expect(href).toMatch(/callback_url=%2Fdashboard|callback_url=\/dashboard/);
      expect(href).toContain('source=mobile');
    });
  });

  test.describe('SSO-enabled mode (Google IdP)', () => {
    test.beforeEach(async ({ page }) => {
      await mockIdp(page, {
        enabled: true,
        ssoOnly: false,
        providers: [
          {
            uuid: 'idp-google',
            idp_alias: 'google',
            display_name: 'Sign in with Google',
            display_icon: 'google',
            display_name_translations: [],
            display_help_translations: [],
          },
        ],
      });
    });

    test('renders the IdP button and the "Sign in with Email" button', async ({ page }) => {
      await page.goto(LOGIN_URL);
      await expect(
        page.getByRole('button', { name: 'Sign in with Google', exact: true })
      ).toBeVisible({ timeout: 10000 });
      await expect(signInWithEmailBtn(page)).toBeVisible();
      // Credential form is hidden until "Sign in with Email" is clicked.
      await expect(emailInput(page)).toHaveCount(0);
    });

    test('clicking "Sign in with Email" reveals the credential form and a Back control', async ({
      page,
    }) => {
      await page.goto(LOGIN_URL);
      await signInWithEmailBtn(page).click();

      await expect(emailInput(page)).toBeVisible();
      await expect(passwordInput(page)).toBeVisible();
      await expect(submitButton(page)).toBeVisible();
      await expect(backControl(page)).toBeVisible();
    });

    test('clicking Back hides the credential form again', async ({ page }) => {
      await page.goto(LOGIN_URL);
      await signInWithEmailBtn(page).click();
      await expect(emailInput(page)).toBeVisible();

      await backControl(page).click();
      await expect(emailInput(page)).toHaveCount(0);
      await expect(signInWithEmailBtn(page)).toBeVisible();
    });

    test('IdP fetch error falls back to the credential form (idpUnavailable branch)', async ({
      page,
    }) => {
      // Override the IdP mock with a 500 — signIn.tsx flips showCredForm true.
      await mockIdp(page, { status: 500 });
      await page.goto(LOGIN_URL);

      await expect(emailInput(page)).toBeVisible({ timeout: 10000 });
      await expect(passwordInput(page)).toBeVisible();
    });
  });

  test.describe('SSO-only mode', () => {
    test.beforeEach(async ({ page }) => {
      await mockIdp(page, { enabled: true, ssoOnly: true });
    });

    test('does NOT render email/password form or "Sign in with Email" button', async ({
      page,
    }) => {
      await page.goto(LOGIN_URL);
      await expect(
        page.getByRole('button', { name: 'Sign in with Google', exact: true })
      ).toBeVisible({ timeout: 10000 });

      await expect(emailInput(page)).toHaveCount(0);
      await expect(passwordInput(page)).toHaveCount(0);
      await expect(signInWithEmailBtn(page)).toHaveCount(0);
    });
  });

  test.describe('Client-side validation', () => {
    test('submitting an empty form surfaces inline validation errors', async ({ page }) => {
      await mockIdp(page, { enabled: false });
      await page.goto(LOGIN_URL);

      await expect(emailInput(page)).toBeVisible({ timeout: 10000 });
      await submitButton(page).click();

      // Mantine renders errors with these wrapper classes.
      await expect(
        page
          .locator('.mantine-TextInput-error, .mantine-PasswordInput-error, .mantine-InputWrapper-error')
          .first()
      ).toBeVisible();
    });

    test('email and password inputs strip whitespace from typed input', async ({ page }) => {
      await mockIdp(page, { enabled: false });
      await page.goto(LOGIN_URL);

      await emailInput(page).pressSequentially('user @ex ample.com', { delay: 10 });
      await expect(emailInput(page)).toHaveValue('user@example.com');

      await passwordInput(page).pressSequentially('Pass W0rd!', { delay: 10 });
      await expect(passwordInput(page)).toHaveValue('PassW0rd!');
    });
  });

  test.describe('Query-param driven banners', () => {
    test('?sessionExpired=true renders the "Your session has expired." alert', async ({ page }) => {
      await mockIdp(page, { enabled: false });
      await page.goto(`${LOGIN_URL}?sessionExpired=true`);

      const alert = errorAlert(page);
      await expect(alert).toBeVisible({ timeout: 10000 });
      await expect(alert).toContainText(TXT.sessionExpired);
    });

    test('?error=<msg> renders the "Something went wrong!" alert', async ({ page }) => {
      await mockIdp(page, { enabled: false });
      await page.goto(`${LOGIN_URL}?error=CredentialsSignin`);

      const alert = errorAlert(page);
      await expect(alert).toBeVisible({ timeout: 10000 });
      await expect(alert).toContainText(TXT.somethingWentWrong);
    });
  });

  test.describe('Authenticated session redirects', () => {
    test('unauthenticated visit to /dashboard redirects to /auth/signIn', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page).toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
    });

    test('authenticated user visiting /auth/signIn is redirected away (server-side)', async ({
      browser,
    }) => {
      test.skip(
        !VALID_EMAIL || !VALID_PASSWORD,
        'TEST_EMAIL and TEST_PASSWORD required to populate playwright/.auth/user.json'
      );

      const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
      const page = await context.newPage();
      await page.goto(LOGIN_URL);
      await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
      await context.close();
    });

    test('authenticated user can reach /dashboard', async ({ browser }) => {
      test.skip(
        !VALID_EMAIL || !VALID_PASSWORD,
        'TEST_EMAIL and TEST_PASSWORD required to populate playwright/.auth/user.json'
      );

      const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
      const page = await context.newPage();
      await page.goto('/dashboard');
      await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 10000 });
      await context.close();
    });
  });

  test.describe('Real backend — happy path (env-gated)', () => {
    test('user can sign in with valid credentials', async ({ page }) => {
      test.skip(!VALID_EMAIL || !VALID_PASSWORD, 'TEST_EMAIL and TEST_PASSWORD env vars required');

      // No IdP mock here — hit the real backend so reCAPTCHA + NextAuth flow runs.
      await page.goto(LOGIN_URL);
      await revealCredentialForm(page);
      await fillCredentials(page, VALID_EMAIL, VALID_PASSWORD);
      await submitButton(page).click();

      await expect(page).not.toHaveURL(LOGIN_URL_RE, { timeout: 30000 });
    });

    test('shows the error alert for invalid credentials', async ({ page }) => {
      await page.goto(LOGIN_URL);
      await revealCredentialForm(page);
      await fillCredentials(page, INVALID_EMAIL, INVALID_PASSWORD);
      await submitButton(page).click();

      await expect(errorAlert(page)).toBeVisible({ timeout: 20000 });
    });
  });
});
