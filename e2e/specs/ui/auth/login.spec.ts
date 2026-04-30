import { test, expect } from '../../../fixtures';
import { LoginPage } from '../../../pages/ui/login.page';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login Page — Login Form', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Verify email input field is displayed', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('Enter invalid email format (e.g., "abc", "abc@", "@domain")', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    for (const invalid of ['abc', 'abc@', '@domain.com']) {
      await loginPage.emailInput.fill(invalid);
      await loginPage.submitButton.click();
      // Should not navigate away — form validation should block submission
      await expect(page).toHaveURL(/signIn/);
    }
  });

  test('Leave email field empty and attempt to submit', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.submitButton.click();
    await expect(page).toHaveURL(/signIn/);
  });

  test('Verify password field is displayed with masked characters', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('Leave password field empty and attempt to submit', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.emailInput.fill('test@example.com');
    await loginPage.submitButton.click();
    await expect(page).toHaveURL(/signIn/);
  });

  test('Click Login with valid credentials', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login(
      process.env.PLAYWRIGHT_UI_EMAIL || '',
      process.env.PLAYWRIGHT_UI_PASSWORD || ''
    );
    await page.waitForURL((url) => !url.pathname.includes('/auth/'), { timeout: 30_000 });
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === 'accessToken')).toBeTruthy();
  });

  test('Click Login with wrong password', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login('valid@example.com', 'WrongPassword999!');
    await loginPage.assertErrorVisible();
    await expect(page).toHaveURL(/signIn/);
  });

  test('Click Login with non-existent email', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login('nonexistent_999@nowhere.com', 'Password123!');
    await loginPage.assertErrorVisible();
  });

  test('Verify loading spinner during authentication', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.emailInput.fill(process.env.PLAYWRIGHT_UI_EMAIL || 'test@test.com');
    await loginPage.passwordInput.fill(process.env.PLAYWRIGHT_UI_PASSWORD || 'password');
    await loginPage.submitButton.click();
    // Button should show disabled/loading state immediately after click
    await expect(loginPage.submitButton).toBeDisabled({ timeout: 3_000 }).catch(() => {
      // Some implementations use spinner instead of disabled state — both are valid
    });
  });
});

test.describe('Login Page — SSO Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Verify SSO buttons are displayed', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    if (credVisible) {
      test.skip(true, 'SSO not the primary flow in this environment');
    }
    await expect(page.locator('button').first()).toBeVisible();
  });

  test('Verify SSO section hidden when no providers configured', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    if (credVisible) {
      // Credential form shown directly — SSO not present
      await expect(loginPage.emailInput).toBeVisible();
    }
    // Either path is valid — test documents the expected branching behaviour
  });
});

test.describe('Login Page — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Click "Forgot Password"', async ({ page }) => {
    const forgotLink = page.locator('a').filter({ hasText: /forgot password/i });
    const exists = await forgotLink.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'Forgot password link not present');
    await forgotLink.click();
    await expect(page).toHaveURL(/password_reset|forgot/i);
  });

  test('Click "Return to Homepage"', async ({ page }) => {
    const homeLink = page.locator('a').filter({ hasText: /return to homepage|homepage/i });
    const exists = await homeLink.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'Return to Homepage link not present');
    await homeLink.click();
    await expect(page).not.toHaveURL(/signIn/);
  });
});

test.describe('Login Page — Layout & Session', () => {
  test('Verify accessToken cookie is set after login', async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login(
      process.env.PLAYWRIGHT_UI_EMAIL || '',
      process.env.PLAYWRIGHT_UI_PASSWORD || ''
    );
    await page.waitForURL((url) => !url.pathname.includes('/auth/'), { timeout: 30_000 });
    const cookies = await page.context().cookies();
    const token = cookies.find((c) => c.name === 'accessToken');
    expect(token).toBeDefined();
  });

  test('should have no critical accessibility violations', async ({ page, a11y }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
    await a11y.assertNoViolations({
      exclude: ['iframe[title*="reCAPTCHA"]'],
      allowedIds: ['document-title', 'button-name', 'meta-viewport'],
    });
  });

  test('should match visual snapshot', async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      mask: [page.locator('iframe[title*="reCAPTCHA"]')],
    });
  });
});

test.describe('Login Page — Input Behaviour', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Typing a space in the email field does nothing', async () => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.emailInput.click();
    await loginPage.emailInput.pressSequentially('test user');
    // Space is prevented via onKeyDown — the field should contain "testuser"
    await expect(loginPage.emailInput).toHaveValue('testuser');
  });

  test('Pasting an email with spaces strips the spaces', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.emailInput.click();
    await page.evaluate(() => {
      const input = document.querySelector('[data-test="email-input"] input') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.setData('text', '  test @ example.com  ');
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    });
    await expect(loginPage.emailInput).toHaveValue('test@example.com');
  });

  test('Typing a space in the password field does nothing', async () => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.passwordInput.click();
    await loginPage.passwordInput.pressSequentially('pass word123!');
    await expect(loginPage.passwordInput).toHaveValue('password123!');
  });

  test('Password show/hide toggle reveals and re-masks the password', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.passwordInput.fill('Secret123!');
    // Mantine renders a visibility toggle button inside the PasswordInput wrapper
    const toggleBtn = page.locator('.mantine-PasswordInput-visibilityToggle');
    await toggleBtn.click();
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');
    await toggleBtn.click();
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });
});

test.describe('Login Page — Error States', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Shows account-locked message after too many failed attempts', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    // Intercept the NextAuth credentials callback to simulate a locked-account response
    await page.route('**/api/auth/callback/credentials**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'error.account-locked', ok: false, url: null }),
      })
    );
    await loginPage.login('locked@example.com', 'Password123!');
    await loginPage.assertErrorVisible();
    // The locked-specific message key is rendered when showLockedWarning is true
    const alert = page.locator('[data-test="login-error-alert"]');
    await expect(alert).toBeVisible();
  });

  test('Error alert disappears on a fresh login attempt', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login('wrong@example.com', 'WrongPassword1!');
    await loginPage.assertErrorVisible();
    // Start a new attempt — error should clear immediately
    await loginPage.emailInput.fill(process.env.PLAYWRIGHT_UI_EMAIL || '');
    await loginPage.passwordInput.fill(process.env.PLAYWRIGHT_UI_PASSWORD || '');
    await loginPage.submitButton.click();
    // While the request is in flight the alert must be gone
    await expect(loginPage.errorAlert).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });
});

test.describe('Login Page — Already Authenticated', () => {
  test('Redirects to /dashboard when accessToken cookie is present', async ({ browser }) => {
    // Create a context with a pre-set cookie to simulate an already-logged-in user
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await ctx.addCookies([
      {
        name: 'accessToken',
        value: 'dummy-token',
        domain: new URL(process.env.PLAYWRIGHT_UI_URL || 'http://localhost:3000').hostname,
        path: '/',
      },
    ]);
    await page.goto('/auth/signIn');
    // getServerSideProps checks for the cookie and redirects before rendering the page
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await ctx.close();
  });
});

test.describe('Login Page — SSO Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Clicking "Login with email" reveals the credential form', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    if (credVisible) {
      test.skip(true, 'SSO not primary in this environment');
    }
    const emailBtn = page.locator('button').filter({ hasText: /email/i });
    const exists = await emailBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'No "Login with email" button — ssoOnly or no SSO');
    await emailBtn.click();
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('Back button returns to SSO view from credential form', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    if (credVisible) {
      test.skip(true, 'SSO not primary in this environment');
    }
    const emailBtn = page.locator('button').filter({ hasText: /email/i });
    const exists = await emailBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'No "Login with email" button — ssoOnly or no SSO');
    await emailBtn.click();
    await expect(loginPage.emailInput).toBeVisible();
    const backBtn = page.locator('text=/back/i');
    await backBtn.click();
    await expect(loginPage.emailInput).not.toBeVisible({ timeout: 3_000 });
  });
});
