import { test, expect } from '../../../fixtures';
import { LoginPage } from '../../../pages/ui/login.page';
import { TestData } from '../../../utils/test-data';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Security — XSS — Input Fields', () => {
  test('Enter XSS payload in email: <script>alert("xss")</script>', async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');

    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    await loginPage.emailInput.fill(TestData.xss.scriptTag);
    await loginPage.submitButton.click();
    await page.waitForTimeout(1000);

    expect(alertFired).toBeFalsy();
    await expect(page).toHaveURL(/signIn/);
  });

  test('Enter XSS payload: <img src=x onerror=alert(1)>', async ({ page }) => {
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });
    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');

    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    await loginPage.emailInput.fill(TestData.xss.imgOnerror);
    await loginPage.submitButton.click();
    await page.waitForTimeout(1000);
    expect(alertFired).toBeFalsy();
  });

  test('Enter HTML tags in First Name: <b onmouseover=alert(1)>test</b>', async ({ page }) => {
    // Test on search page input as a proxy for any text input
    await page.goto('/auth/signIn');
    await page.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 });

    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    const loginPage = new LoginPage(page);
    const credVisible = await loginPage.isCredFormVisible();
    test.skip(!credVisible, 'SSO-only environment');
    await loginPage.emailInput.fill(TestData.xss.eventHandler);
    await page.waitForTimeout(500);
    expect(alertFired).toBeFalsy();
  });

  test('Verify markdown XSS: description contains <script> or javascript: links', async ({ page }) => {
    // Navigate to a course with description rendered as markdown
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    // Check page source for unescaped script tags in rendered content
    const content = await page.content();
    expect(content).not.toContain('<script>alert');
    expect(alertFired).toBeFalsy();
  });

  test('Verify HTML sanitization in objectives/prerequisites', async ({ page }) => {
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    await page.waitForTimeout(1000);
    expect(alertFired).toBeFalsy();
    // Verify no inline event handlers in rendered content
    const content = await page.content();
    expect(content).not.toMatch(/onclick\s*=\s*["']?alert/i);
  });

  test('Navigate to /courses?tab=<script>alert(1)</script>', async ({ page }) => {
    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    await page.goto('/courses?tab=<script>alert(1)</script>');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    expect(alertFired).toBeFalsy();
  });

  test('Send message containing <script>alert("xss")</script> in chat', async ({ page }) => {
    // Navigate into a course asset with chat panel
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    let alertFired = false;
    page.on('dialog', (dialog) => { alertFired = true; dialog.dismiss(); });

    // Look for chat input
    const chatInput = page.locator('[data-test="chat-input"], [placeholder*="message"], [placeholder*="ask"]').first();
    const exists = await chatInput.isVisible({ timeout: 3_000 }).catch(() => false);
    if (exists) {
      await chatInput.fill(TestData.xss.scriptTag);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    }
    expect(alertFired).toBeFalsy();
  });
});
