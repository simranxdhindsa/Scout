import { test, expect } from '../../../fixtures';
import { SwLoginPage } from '../../../pages/studio-web/login.page';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Studio-Web — Login', () => {
  let loginPage: SwLoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new SwLoginPage(page);
    await loginPage.goto();
  });

  test('Login page loads with email and password fields', async ({ page }) => {
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });

  test('Submit with empty fields shows validation error', async ({ page }) => {
    await loginPage.submitButton.click();
    const error = page.locator('[role="alert"], .mantine-InputWrapper-error').first();
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('Invalid email format shows validation error', async ({ page }) => {
    await loginPage.emailInput.fill('not-an-email');
    await loginPage.passwordInput.fill('anypassword');
    await loginPage.submitButton.click();
    const error = page.locator('[role="alert"], .mantine-InputWrapper-error').first();
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('Wrong credentials shows error message', async ({ page }) => {
    await loginPage.login('wrong@example.com', 'wrongpassword');
    await expect(loginPage.errorAlert).toBeVisible({ timeout: 8_000 });
  });

  test('Valid credentials redirect away from login page', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_SW_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_SW_PASSWORD ?? '';
    test.skip(!email || !password, 'SW credentials not configured');
    await loginPage.login(email, password);
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 });
    await expect(page).not.toHaveURL(/login/);
  });

  test('Password field masks characters by default', async ({ page }) => {
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('Login page has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });

  test('Login page matches visual baseline', async ({ page }) => {
    await page.locator('form').waitFor({ state: 'visible' });
    await expect(page).toHaveScreenshot('sw-login.png', { fullPage: false });
  });
});
