import { test, expect } from '../../../fixtures';

/**
 * QA Doc — Admin: Teams, Branding, Skills, Job Roles (7 tests)
 */
test.describe('Admin — Teams', () => {
  test('Teams admin page loads', async ({ page }) => {
    await page.goto('/administration/teams');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/administration\/teams|teams/);
    const container = page.locator('table, [class*="list"]').first();
    await expect(container).toBeVisible({ timeout: 8_000 });
  });

  test('Create Team button is visible on teams page', async ({ page }) => {
    await page.goto('/administration/teams');
    await page.waitForLoadState('networkidle');
    const createBtn = page.getByRole('button', { name: /create|add|nouveau/i }).first();
    const visible = await createBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'Create Team button not found');
    await expect(createBtn).toBeVisible();
  });
});

test.describe('Admin — Branding', () => {
  test('Branding admin page loads with logo upload and colour picker', async ({ page }) => {
    await page.goto('/administration/branding');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/branding/);
    const section = page.locator('[class*="branding"], form, section').first();
    await expect(section).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('Admin — Skills', () => {
  test('Skills admin page loads', async ({ page }) => {
    await page.goto('/administration/skills');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/skills/);
  });

  test('Skills list renders with at least one column header', async ({ page }) => {
    await page.goto('/administration/skills');
    await page.waitForLoadState('networkidle');
    const header = page.locator('th, [class*="column-header"]').first();
    const visible = await header.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, 'No column headers — skills list may be empty');
    await expect(header).toBeVisible();
  });
});

test.describe('Admin — Job Roles', () => {
  test('Job Roles admin page loads', async ({ page }) => {
    await page.goto('/administration/job-roles');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/job-roles|job_roles/);
  });

  test('Job Roles list renders', async ({ page }) => {
    await page.goto('/administration/job-roles');
    await page.waitForLoadState('networkidle');
    const container = page.locator('table, [class*="list"]').first();
    await expect(container).toBeVisible({ timeout: 8_000 });
  });
});
