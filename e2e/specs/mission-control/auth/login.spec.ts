import { test, expect } from '../../../fixtures';
import { McLoginPage } from '../../../pages/mission-control/login.page';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Mission-Control — Login', () => {
  let loginPage: McLoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new McLoginPage(page);
    await loginPage.goto();
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
  });

  test('Verify email input field is displayed', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('Verify password field is displayed with masked characters', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('Click Login with valid credentials', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login(
      process.env.PLAYWRIGHT_MC_EMAIL || '',
      process.env.PLAYWRIGHT_MC_PASSWORD || ''
    );
    await page.waitForURL((url) => !url.pathname.includes('/auth/'), { timeout: 30_000 });
    await expect(page).not.toHaveURL(/signIn/);
  });

  test('Click Login with wrong password', async ({ page }) => {
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.login('test@example.com', 'WrongPassword999!');
    await expect(loginPage.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/signIn/);
  });

  test('should have no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations({
      exclude: ['iframe[title*="reCAPTCHA"]'],
      allowedIds: ['document-title', 'button-name', 'meta-viewport'],
    });
  });

  test('should match visual snapshot', async ({ page }) => {
    await expect(page).toHaveScreenshot('mc-login.png', {
      fullPage: true,
      mask: [page.locator('iframe[title*="reCAPTCHA"]')],
    });
  });
});
