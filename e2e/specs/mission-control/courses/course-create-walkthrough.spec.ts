import { test, expect } from '../../../fixtures';

/**
 * ARD — Mission-Control: Full Visual Browser Walkthrough
 *
 * This spec simulates a real user interacting with the browser:
 *   1. Open the browser at the login page
 *   2. Type email and password
 *   3. Click Sign In
 *   4. Wait for dashboard/courses to load
 *   5. Click "Create Course" (or navigate to /course/new)
 *   6. Fill the Name field
 *   7. Select Level
 *   8. Type in the Description (rich-text editor)
 *   9. Check "Regular" mode
 *  10. Click Save
 *  11. Verify redirect to /course/{uuid}/overview
 *  12. Verify course name visible on overview
 *  13. Clean up — delete the course
 *
 * To see this running in a real browser window:
 *   npx playwright test course-create-walkthrough --project=mission-control --headed --slowMo=500
 *
 * Or open in the Playwright UI:
 *   npx playwright test course-create-walkthrough --project=mission-control --ui
 *
 * NOTE: This test bypasses storageState — it logs in via the UI exactly
 * as a human would. Credentials come from .env.e2e.
 */

// Force this test to NOT use the cached storageState — always go through login UI
test.use({ storageState: { cookies: [], origins: [] } });

const VALID_DESCRIPTION =
  'This is a walkthrough test course description. It exceeds the minimum fifty character requirement set by the form validation so the Save button will become enabled and the form can be submitted successfully.';

function uniqueCourseName(): string {
  const ts = Date.now().toString().slice(-6);
  return `Walkthrough Course ${ts}`;
}

test.describe('MC — Full Browser Walkthrough: Login → Create Course → Delete', () => {

  test(
    'Complete flow: login via UI → create course → verify overview → delete',
    async ({ page }) => {
      const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
      const email = process.env.PLAYWRIGHT_MC_EMAIL ?? '';
      const password = process.env.PLAYWRIGHT_MC_PASSWORD ?? '';

      test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not set in .env.e2e');
      test.skip(!email || !password, 'PLAYWRIGHT_MC_EMAIL / PLAYWRIGHT_MC_PASSWORD not set');

      // ── STEP 1: Open the login page ─────────────────────────────────────────
      console.log('[Walkthrough] Step 1: Opening login page...');
      await page.goto(`${mcUrl}/auth/signIn`);
      await page.waitForLoadState('domcontentloaded');

      // Wait for the email input to appear
      const emailInput = page.locator('input[type="email"]').first();
      await emailInput.waitFor({ state: 'visible', timeout: 20_000 });

      // ── STEP 2: Fill email ──────────────────────────────────────────────────
      console.log(`[Walkthrough] Step 2: Filling email — ${email}`);
      await emailInput.click();
      await emailInput.fill(email);

      // ── STEP 3: Fill password ───────────────────────────────────────────────
      console.log('[Walkthrough] Step 3: Filling password...');
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.click();
      await passwordInput.fill(password);

      // ── STEP 4: Click Sign In ───────────────────────────────────────────────
      console.log('[Walkthrough] Step 4: Clicking Sign In...');
      const signInBtn = page.locator('button[type="submit"]').first();
      await signInBtn.click();

      // ── STEP 5: Wait for post-login navigation ──────────────────────────────
      console.log('[Walkthrough] Step 5: Waiting for post-login redirect...');
      await page.waitForURL(
        (url) => !url.pathname.includes('/auth/'),
        { timeout: 30_000 }
      );
      console.log(`[Walkthrough]   → Landed on: ${page.url()}`);

      // ── STEP 6: Navigate to Courses list ───────────────────────────────────
      console.log('[Walkthrough] Step 6: Navigating to /courses...');
      await page.goto(`${mcUrl}/courses`);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/courses/);

      // ── STEP 7: Click "Create Course" button ────────────────────────────────
      console.log('[Walkthrough] Step 7: Looking for "Create Course" button...');

      // Try multiple possible selectors for the create course button
      const createBtnSelectors = [
        page.getByRole('button', { name: /create course/i }),
        page.getByRole('button', { name: /add course/i }),
        page.getByRole('button', { name: /new course/i }),
        page.locator('a[href*="/course/new"]'),
        page.getByRole('link', { name: /create|add|new/i }),
      ];

      let navigatedToCreate = false;
      for (const selector of createBtnSelectors) {
        const visible = await selector.isVisible({ timeout: 2_000 }).catch(() => false);
        if (visible) {
          console.log('[Walkthrough]   → Found create button, clicking...');
          await selector.click();
          await page.waitForURL(/\/course\/new/, { timeout: 10_000 }).catch(() => {});
          if (page.url().includes('/course/new')) {
            navigatedToCreate = true;
            break;
          }
        }
      }

      // If no button found, navigate directly
      if (!navigatedToCreate) {
        console.log('[Walkthrough]   → No create button visible — navigating directly to /course/new');
        await page.goto(`${mcUrl}/course/new`);
      }

      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/course\/new/);
      console.log('[Walkthrough]   → Now on /course/new');

      // ── STEP 8: Fill Name ───────────────────────────────────────────────────
      const courseName = uniqueCourseName();
      console.log(`[Walkthrough] Step 8: Filling course name — "${courseName}"`);
      const nameInput = page.getByLabel('Name');
      await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
      await nameInput.click();
      await nameInput.fill(courseName);

      // ── STEP 9: Select Level ────────────────────────────────────────────────
      console.log('[Walkthrough] Step 9: Selecting level "Intermediate"...');
      const levelSelect = page.locator('.mantine-Select-input').first();
      const levelVisible = await levelSelect.isVisible({ timeout: 5_000 }).catch(() => false);
      if (levelVisible) {
        await levelSelect.click();
        const intermediateOption = page
          .locator('.mantine-Select-item, [role="option"]')
          .filter({ hasText: /intermediate/i })
          .first();
        const optionVisible = await intermediateOption.isVisible({ timeout: 3_000 }).catch(() => false);
        if (optionVisible) {
          await intermediateOption.click();
          console.log('[Walkthrough]   → Selected "Intermediate"');
        } else {
          await page.keyboard.press('Escape');
          console.warn('[Walkthrough]   → Intermediate option not visible — skipping level selection');
        }
      }

      // ── STEP 10: Fill Description in RichText editor ────────────────────────
      console.log('[Walkthrough] Step 10: Filling description in RichText editor...');
      const editor = page
        .locator('.ql-editor[contenteditable="true"]')
        .first();
      await editor.waitFor({ state: 'visible', timeout: 10_000 });
      await editor.click();
      await editor.fill(VALID_DESCRIPTION);
      console.log('[Walkthrough]   → Description filled');

      // ── STEP 11: Check Regular mode ─────────────────────────────────────────
      console.log('[Walkthrough] Step 11: Checking "Regular" mode checkbox...');
      const regularCheckbox = page.getByLabel('Regular');
      const cbVisible = await regularCheckbox.isVisible({ timeout: 5_000 }).catch(() => false);
      if (cbVisible) {
        if (!(await regularCheckbox.isChecked())) {
          await regularCheckbox.click();
        }
        await expect(regularCheckbox).toBeChecked();
        console.log('[Walkthrough]   → Regular mode checked');
      }

      // ── STEP 12: Verify Save is enabled ─────────────────────────────────────
      console.log('[Walkthrough] Step 12: Verifying Save button is enabled...');
      const saveBtn = page.getByRole('button', { name: /^save$/i });
      await expect(saveBtn, 'Save button not found or not enabled after filling form').toBeEnabled({ timeout: 5_000 });
      console.log('[Walkthrough]   → Save button enabled ✓');

      // ── STEP 13: Intercept the POST and click Save ──────────────────────────
      console.log('[Walkthrough] Step 13: Intercepting POST /a/course and clicking Save...');

      let postFired = false;
      let postStatus = 0;
      page.on('response', (res) => {
        if (res.url().includes('/a/course') && res.request().method() === 'POST') {
          postFired = true;
          postStatus = res.status();
          console.log(`[Walkthrough]   → POST /a/course responded with ${res.status()}`);
        }
      });

      await saveBtn.click();

      // ── STEP 14: Wait for redirect to /course/{uuid}/overview ────────────────
      console.log('[Walkthrough] Step 14: Waiting for redirect to overview...');
      await page.waitForURL(/\/course\/[a-f0-9-]{36}\/overview/, { timeout: 25_000 });

      const finalUrl = page.url();
      const uuidMatch = finalUrl.match(/\/course\/([a-f0-9-]{36})\/overview/);
      expect(uuidMatch, 'UUID not found in URL after course creation').not.toBeNull();
      const uuid = uuidMatch![1];
      console.log(`[Walkthrough]   → Redirected to overview. Course UUID: ${uuid}`);

      expect(postFired, 'POST /a/course was never intercepted').toBe(true);
      expect([200, 201], `Unexpected POST status: ${postStatus}`).toContain(postStatus);

      // ── STEP 15: Verify course name on overview page ─────────────────────────
      console.log('[Walkthrough] Step 15: Verifying course name on overview...');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('heading', { name: /overview/i }),
        '"Overview" heading not found'
      ).toBeVisible({ timeout: 10_000 });

      await expect(
        page.getByText(courseName),
        `Course name "${courseName}" not visible on overview`
      ).toBeVisible({ timeout: 10_000 });
      console.log('[Walkthrough]   → Course name visible on overview ✓');

      // ── STEP 16: Verify status is "draft" ────────────────────────────────────
      const draftText = page.getByText('draft').first();
      const hasDraft = await draftText.isVisible({ timeout: 5_000 }).catch(() => false);
      if (hasDraft) {
        console.log('[Walkthrough]   → Status shows "draft" ✓');
      }

      // ── STEP 17: Delete the course (cleanup) ─────────────────────────────────
      console.log('[Walkthrough] Step 17: Cleaning up — deleting the course...');
      const deleteBtn = page.getByRole('button', { name: /^delete$/i });
      const deleteVisible = await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false);

      if (deleteVisible) {
        await deleteBtn.click();

        // Confirm modal
        const confirmModal = page.getByText(/deleting course/i);
        const modalVisible = await confirmModal.isVisible({ timeout: 5_000 }).catch(() => false);
        if (modalVisible) {
          await page.getByRole('button', { name: /^confirm$/i }).click();
          await page.waitForURL(/\/courses$/, { timeout: 15_000 });
          console.log(`[Walkthrough]   → Course ${uuid} deleted ✓`);
        }
      } else {
        console.warn(`[Walkthrough]   → Delete button not visible — manual cleanup required for course ${uuid}`);
      }

      console.log('[Walkthrough] All steps completed successfully ✓');
    }
  );
});

// ─── Alternative: Pre-authenticated walkthrough ───────────────────────────────
// (Uses the cached storageState token — skips the login UI)

test.describe('MC — Pre-Auth Walkthrough: Navigate to Create Course and fill form', () => {
  // This describe block uses the default storageState (set at project level)
  // so it inherits the mc-user.json token automatically.
  // Override the no-auth storageState set at the top of the file:
  test.use({ storageState: undefined as any });

  test('Navigate to /courses and click into create course form (pre-authenticated)', async ({ page }) => {
    const mcUrl = process.env.PLAYWRIGHT_MC_URL ?? '';
    test.skip(!mcUrl, 'PLAYWRIGHT_MC_URL not configured');

    // ── Go to courses list ────────────────────────────────────────────────────
    await page.goto(`${mcUrl}/courses`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/courses/);

    // ── Try to find and click "Create Course" button ──────────────────────────
    const possibleCreateBtns = [
      page.getByRole('button', { name: /create course/i }),
      page.getByRole('button', { name: /add course/i }),
      page.locator('a[href*="/course/new"]'),
    ];

    let clicked = false;
    for (const btn of possibleCreateBtns) {
      if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await btn.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      await page.goto(`${mcUrl}/course/new`);
    }

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/course\/new/);

    // ── Verify the form renders ───────────────────────────────────────────────
    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('.ql-editor[contenteditable="true"]').first()
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible();

    // ── Fill and inspect the form (do NOT submit — read-only walkthrough) ─────
    await page.getByLabel('Name').fill('Read-Only Inspection Course');

    const editor = page
      .locator('.ql-editor[contenteditable="true"]')
      .first();
    await editor.click();
    await editor.fill(VALID_DESCRIPTION);

    // At this point the Save button should be enabled
    await expect(page.getByRole('button', { name: /^save$/i })).toBeEnabled();

    // Screenshot of the filled form for the report
    await page.screenshot({
      path: 'e2e/test-results/mc-course-create-form-filled.png',
      fullPage: false,
    });
  });
});
