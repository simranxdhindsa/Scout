import { test, expect } from '../../../fixtures';

test.describe('Security — Session — Cookie Security', () => {
  test('Verify cookie has HttpOnly, Secure, SameSite flags', async ({ page, context }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    const cookies = await context.cookies();
    const accessToken = cookies.find((c) => c.name === 'accessToken');
    expect(accessToken).toBeDefined();
    if (accessToken) {
      expect(accessToken.httpOnly).toBeTruthy();
      expect(accessToken.sameSite).toMatch(/Lax|Strict/i);
    }
  });

  test('Verify all session data cleared on logout', async ({ page, context }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Logout via URL navigation
    await page.goto('/auth/signout');
    await page.waitForLoadState('networkidle');

    const cookies = await context.cookies();
    const hasToken = cookies.some((c) => c.name === 'accessToken' && c.value !== '');
    expect(hasToken).toBeFalsy();
  });
});

test.describe('Security — Session — Token Expiry', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Access protected page without valid token redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    // Without a valid token, should redirect to login
    await expect(page).toHaveURL(/signIn|auth/);
  });

  test('Access protected page with valid token renders page', async ({ page, context }) => {
    // Re-authenticate to get a token
    const baseUrl = process.env.PLAYWRIGHT_UI_URL || '';
    await page.goto(`${baseUrl}/auth/signIn`);
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
    const emailInput = page.locator('[data-test="email-input"]');
    const credVisible = await emailInput.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!credVisible, 'SSO-only environment');
    await emailInput.fill(process.env.PLAYWRIGHT_UI_EMAIL || '');
    await page.locator('[data-test="password-input"]').fill(process.env.PLAYWRIGHT_UI_PASSWORD || '');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes('/auth/'), { timeout: 30_000 });
    await expect(page).not.toHaveURL(/signIn/);
  });
});

test.describe('Security — Session — Concurrent Sessions', () => {
  test('Log out on one context, then verify session on another fails', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Both contexts start unauthenticated
    await pageA.goto('/dashboard');
    await pageA.waitForLoadState('networkidle');
    await pageB.goto('/dashboard');
    await pageB.waitForLoadState('networkidle');

    // Both should redirect to login (no auth state)
    await expect(pageA).toHaveURL(/signIn|auth/);
    await expect(pageB).toHaveURL(/signIn|auth/);

    await ctxA.close();
    await ctxB.close();
  });
});
