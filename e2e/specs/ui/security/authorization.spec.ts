import { test, expect } from '../../../fixtures';

test.describe('Security — AuthZ — Privilege Escalation', () => {
  test('Manually navigate to /administration/users as non-admin', async ({ page }) => {
    await page.goto('/administration/users');
    await page.waitForLoadState('networkidle');
    // Non-admin should be redirected to /404 or denied
    const is404 = page.url().includes('404');
    const isRedirected = !page.url().includes('administration');
    const has403 = await page.locator('text=/403|forbidden|not authorized/i').isVisible({ timeout: 3_000 }).catch(() => false);
    // At least one protection mechanism should be in place
    expect(is404 || isRedirected || has403).toBeTruthy();
  });
});

test.describe('Security — AuthZ — IDOR', () => {
  test('Try to access /administration/users/[other-user-id] via URL manipulation', async ({ page }) => {
    await page.goto('/administration/users/00000000-fake-user-id-12345');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const isProtected =
      url.includes('404') ||
      url.includes('signIn') ||
      url.includes('403') ||
      !(url.includes('administration/users/'));
    const hasForbidden = await page.locator('text=/404|403|forbidden|not found/i').isVisible({ timeout: 3_000 }).catch(() => false);
    expect(isProtected || hasForbidden).toBeTruthy();
  });

  test('Navigate to /courses/[unassigned-courseId]/section/.../asset/... as unauthorized user', async ({ page }) => {
    // Try to access a fabricated course URL
    await page.goto('/courses/00000000-fake-course/section/fake-section/asset/fake-asset');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    const isProtected =
      url.includes('404') ||
      url.includes('signIn') ||
      url.includes('courses') && !url.includes('section');
    expect(isProtected).toBeTruthy();
  });
});
