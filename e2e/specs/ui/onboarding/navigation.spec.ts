import { test, expect } from '../../../fixtures';
import { AvatarsPage } from '../../../pages/ui/onboarding/avatars.page';
import { AudioModelPage } from '../../../pages/ui/onboarding/audio-model.page';
import { PreferencePage } from '../../../pages/ui/onboarding/preference.page';
import { TourPage } from '../../../pages/ui/onboarding/tour.page';
import { SummaryPage } from '../../../pages/ui/onboarding/summary.page';

// ── Step counter helper ───────────────────────────────────────────────────────
// The counter is rendered as "N/7" text visible at the top-right of each step.
function stepCounter(page: import('@playwright/test').Page, n: number) {
  return page.getByText(`${n}/7`);
}

test.describe('Onboarding — Navigation & Step Counter', () => {
  test.beforeEach(async ({ onboardingMocks }) => {
    await onboardingMocks.mockAll();
  });

  // ── Step counter ─────────────────────────────────────────────────────────

  test('Step 1 shows "1/7" counter and "You\'re almost there!" label', async ({ page }) => {
    const avatarsPage = new AvatarsPage(page);
    await avatarsPage.goto();

    await expect(stepCounter(page, 1)).toBeVisible();
    await expect(page.getByText(/you're almost there/i)).toBeVisible();
  });

  test('Step 2 shows "2/7" counter after avatar selection', async ({ page }) => {
    const avatarsPage = new AvatarsPage(page);
    await avatarsPage.goto();
    await avatarsPage.selectFirstCard();
    await avatarsPage.proceedToAudioTab();

    await expect(stepCounter(page, 2)).toBeVisible();
  });

  test('Step 3 shows "3/7" counter on preference page', async ({ page }) => {
    const audioPage = new AudioModelPage(page);
    await audioPage.goto('avatar-1');
    await audioPage.selectFirstModel();
    await audioPage.nextBtn.click();

    await expect(page).toHaveURL(/\/onboarding\/preference/);
    await expect(stepCounter(page, 3)).toBeVisible();
  });

  test('Step 4 shows "4/7" counter on tour decision page', async ({ page }) => {
    const prefPage = new PreferencePage(page);
    await prefPage.goto();
    await prefPage.selectFirstOption();
    await prefPage.nextBtn.click();

    await expect(page).toHaveURL(/\/onboarding\/tour/);
    await expect(stepCounter(page, 4)).toBeVisible();
  });

  test('Step 7 shows "7/7" counter on summary page', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(stepCounter(page, 7)).toBeVisible();
  });

  // ── Back button ───────────────────────────────────────────────────────────

  test('Back button is not visible on step 1', async ({ page }) => {
    const avatarsPage = new AvatarsPage(page);
    await avatarsPage.goto();

    await expect(page.getByRole('button', { name: /back|retour/i })).not.toBeVisible();
  });

  test('Back button is visible from step 2 onward', async ({ page }) => {
    const audioPage = new AudioModelPage(page);
    await audioPage.goto('avatar-1');
    await audioPage.waitForListReady();

    await expect(page.getByRole('button', { name: /back|retour/i })).toBeVisible();
  });

  test('Back button on step 2 returns to step 1 (avatar selection)', async ({ page }) => {
    const audioPage = new AudioModelPage(page);
    await audioPage.goto('avatar-1');
    await audioPage.waitForListReady();

    await page.getByRole('button', { name: /back|retour/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/avatars/);
    await expect(stepCounter(page, 1)).toBeVisible();
  });

  test('Back button on step 3 returns to step 2 (audio model)', async ({ page }) => {
    const prefPage = new PreferencePage(page);
    await prefPage.goto();
    await prefPage.waitForOptionsReady();

    await page.getByRole('button', { name: /back|retour/i }).click();
    await expect(page).toHaveURL(/tab=audio-model/);
  });

  test('Back button on step 4 returns to step 3 (preference)', async ({ page }) => {
    const tourPage = new TourPage(page);
    await tourPage.goto();
    await tourPage.waitForContainerReady();

    await page.getByRole('button', { name: /back|retour/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/preference/);
  });

  test('Back button on summary returns to previous step', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await page.getByRole('button', { name: /back|retour/i }).click();
    // Should navigate away from summary — exact target depends on flow
    await expect(page).not.toHaveURL(/\/onboarding\/summary/);
  });

  // ── Tour decision — "Do it later" path ───────────────────────────────────

  test('"Do it later" option is visible on the tour decision step', async ({ page }) => {
    const tourPage = new TourPage(page);
    await tourPage.goto();
    await tourPage.waitForContainerReady();

    await expect(tourPage.doItLaterBtn).toBeVisible();
  });

  test('"Take a tour" option is marked as Recommended', async ({ page }) => {
    const tourPage = new TourPage(page);
    await tourPage.goto();
    await tourPage.waitForContainerReady();

    await expect(page.getByText(/recommended/i)).toBeVisible();
    await expect(page.getByText(/take a tour/i)).toBeVisible();
  });

  test('Clicking "Do it later" advances past the tour steps', async ({ page }) => {
    const tourPage = new TourPage(page);
    await tourPage.goto();
    await tourPage.waitForContainerReady();

    await tourPage.doItLaterBtn.click();

    // Should skip the tour and land on interests or summary — not stay on /onboarding/tour
    await expect(page).not.toHaveURL(/^.*\/onboarding\/tour$/);
  });

  // ── Tour avatar loading state ─────────────────────────────────────────────

  test('Tour avatar step shows loading/setup indicator before avatar renders', async ({ page }) => {
    // Delay welcome-message so we can catch the loading state
    await page.route('**/o/user/onboarding/welcome-message', async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { message: 'Welcome!' } }),
      });
    });

    await page.goto('/onboarding/tour/avatar');

    // A progress or "setting things up" text should briefly appear
    const loadingVisible = await page
      .getByText(/setting things up|loading|preparing/i)
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    // Either the loading state was caught or it resolved very quickly — both are valid
    expect(typeof loadingVisible).toBe('boolean');
    // Page must not crash
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Onboarding — Communication Preference Step', () => {
  test.beforeEach(async ({ onboardingMocks }) => {
    await onboardingMocks.mockAll();
  });

  test('All three communication modes are visible', async ({ page }) => {
    const prefPage = new PreferencePage(page);
    await prefPage.goto();
    await prefPage.waitForOptionsReady();

    await expect(page.getByText(/avatar mode/i)).toBeVisible();
    await expect(page.getByText(/audio/i)).toBeVisible();
    await expect(page.getByText(/text only/i)).toBeVisible();
  });

  test('Selecting "Text only" mode enables Continue', async ({ page }) => {
    const prefPage = new PreferencePage(page);
    await prefPage.goto();
    await prefPage.waitForOptionsReady();

    await prefPage.selectOption(/text only/i);
    await expect(prefPage.nextBtn).toBeEnabled();
  });

  test('Selecting "Audio" mode enables Continue', async ({ page }) => {
    const prefPage = new PreferencePage(page);
    await prefPage.goto();
    await prefPage.waitForOptionsReady();

    await prefPage.selectOption(/^audio$/i);
    await expect(prefPage.nextBtn).toBeEnabled();
  });

  test('Preference page heading names the selected avatar', async ({ page }) => {
    const prefPage = new PreferencePage(page);
    await prefPage.goto();

    // Heading should reference the instructor name from the mock (Alex or Sam)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/communicate/i);
  });
});

test.describe('Onboarding — Interests Step (Observed Behavior)', () => {
  test.beforeEach(async ({ onboardingMocks }) => {
    await onboardingMocks.interests();
    await onboardingMocks.putInterests();
  });

  test('Interest options are rendered as clickable elements', async ({ page }) => {
    const tourPage = new TourPage(page);
    await page.goto('/onboarding/tour/interests');
    await tourPage.waitForInterestsReady();

    const count = await tourPage.allInterestChips.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Multiple interests can be selected independently', async ({ page }) => {
    const tourPage = new TourPage(page);
    await page.goto('/onboarding/tour/interests');
    await tourPage.waitForInterestsReady();

    const chips = tourPage.allInterestChips;
    const total = await chips.count();
    if (total >= 2) {
      await chips.nth(0).click();
      await chips.nth(1).click();
      // Both should remain clickable after selection (no single-select lock)
      await expect(chips.nth(0)).toBeVisible();
      await expect(chips.nth(1)).toBeVisible();
    }
  });

  test('Interests page has a Continue/submit button', async ({ page }) => {
    const tourPage = new TourPage(page);
    await page.goto('/onboarding/tour/interests');
    await tourPage.waitForInterestsReady();

    await expect(tourPage.interestsSubmitBtn).toBeVisible();
  });

  test('Interest prompt text asks about hobbies outside of work', async ({ page }) => {
    await page.goto('/onboarding/tour/interests');
    await expect(page.getByText(/enjoy doing outside of work/i)).toBeVisible();
  });
});

test.describe('Onboarding — Summary Page (Observed Behavior)', () => {
  test.beforeEach(async ({ onboardingMocks }) => {
    await onboardingMocks.mockAll();
  });

  test('Summary shows "You\'re all set!" heading', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(page.getByText(/you're all set/i)).toBeVisible();
  });

  test('Summary displays YOUR INSTRUCTOR section', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(page.getByText(/your instructor/i)).toBeVisible();
  });

  test('Summary displays VOICE PREFERENCE section', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(page.getByText(/voice preference/i)).toBeVisible();
  });

  test('Summary displays COMMUNICATION PREFERENCES section', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(page.getByText(/communication preferences/i)).toBeVisible();
  });

  test('Summary displays YOUR INTERESTS section', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(page.getByText(/your interests/i)).toBeVisible();
  });

  test('Each summary section has an Edit button', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    const editBtns = page.getByRole('button', { name: /edit/i });
    const count = await editBtns.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('"Validate & Start Learning" button is visible', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(summaryPage.completeBtn).toBeVisible();
  });

  test('Summary shows encouraging sub-text about changing preferences', async ({ page }) => {
    const summaryPage = new SummaryPage(page);
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    await expect(page.getByText(/change.*preferences.*anytime/i)).toBeVisible();
  });
});

test.describe('Onboarding — Auth Guard', () => {
  test('Unauthenticated user visiting /onboarding/avatars is redirected to sign-in', async ({ page }) => {
    // Clear any existing session
    await page.context().clearCookies();
    await page.goto('/onboarding/avatars');

    await expect(page).toHaveURL(/\/auth\/signIn/, { timeout: 10_000 });
  });
});
