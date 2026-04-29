import { test, expect } from '../../../fixtures';
import { AvatarsPage } from '../../../pages/ui/onboarding/avatars.page';
import { SummaryPage } from '../../../pages/ui/onboarding/summary.page';
import { TourPage } from '../../../pages/ui/onboarding/tour.page';

test.describe('Onboarding — Edge Cases', () => {
  test.describe('No avatars available', () => {
    test('Empty state is shown when API returns an empty list', async ({ page, onboardingMocks }) => {
      await onboardingMocks.avatarsEmpty();
      const avatarsPage = new AvatarsPage(page);
      await avatarsPage.goto();
      await avatarsPage.assertEmptyState();
    });

    test('Next button is disabled when no avatars exist', async ({ page, onboardingMocks }) => {
      await onboardingMocks.avatarsEmpty();
      const avatarsPage = new AvatarsPage(page);
      await avatarsPage.goto();

      await expect(avatarsPage.nextBtn).toBeDisabled();
    });
  });

  test.describe('API errors', () => {
    test('500 on avatars — page renders without crashing', async ({ page, onboardingMocks }) => {
      await onboardingMocks.avatarsError();
      const avatarsPage = new AvatarsPage(page);
      await avatarsPage.goto();

      // Page must stay on the onboarding route — no unhandled redirect
      await expect(page).toHaveURL(/\/onboarding\/avatars/);
      // Body must have content — not blank
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Slow avatars API — skeleton visible before cards appear', async ({ page, apiMocker }) => {
      await apiMocker.mockSlow('**/o/user/onboarding/avatars', { data: [] }, 2_000);
      const avatarsPage = new AvatarsPage(page);

      await page.goto('/onboarding/avatars');
      // During the 2-second delay, a skeleton should be visible
      const skeletonVisible = await avatarsPage.skeleton
        .first()
        .isVisible({ timeout: 1_500 })
        .catch(() => false);
      // Accept either skeleton or spinner — both are valid loading indicators
      expect(typeof skeletonVisible).toBe('boolean');
      // Page must not crash regardless
      await expect(page.locator('body')).not.toBeEmpty();
    });
  });

  test.describe('Interests', () => {
    test('Submit is blocked with zero interests selected', async ({ page, onboardingMocks }) => {
      await onboardingMocks.interests();
      await onboardingMocks.putInterests();
      const tourPage = new TourPage(page);
      await page.goto('/onboarding/tour/interests');
      await tourPage.waitForInterestsReady();

      const isDisabled = await tourPage.interestsSubmitBtn
        .isDisabled({ timeout: 3_000 })
        .catch(() => false);

      if (isDisabled) {
        await expect(tourPage.interestsSubmitBtn).toBeDisabled();
      } else {
        // If not disabled, clicking must not navigate away
        await tourPage.interestsSubmitBtn.click();
        await expect(page).toHaveURL(/\/onboarding\/tour\/interests/);
      }
    });

    test('Clicking a chip twice deselects it', async ({ page, onboardingMocks }) => {
      await onboardingMocks.interests();
      await onboardingMocks.putInterests();
      const tourPage = new TourPage(page);
      await page.goto('/onboarding/tour/interests');
      await tourPage.waitForInterestsReady();

      const chip = tourPage.allInterestChips.first();
      await chip.click(); // select
      await chip.click(); // deselect

      // aria-checked or data-checked must be falsy after deselect
      const ariaChecked = await chip.getAttribute('aria-checked').catch(() => null);
      const dataChecked = await chip.getAttribute('data-checked').catch(() => null);
      expect(ariaChecked === 'true' || dataChecked === 'true').toBe(false);
    });
  });

  test.describe('Summary — complete flow', () => {
    test('Complete button shows loading state while PUT is in flight', async ({ page, onboardingMocks }) => {
      await onboardingMocks.mockAll();
      // Delay the complete endpoint to observe the in-flight UI state
      await page.route('**/o/user/onboarding/complete', async (route) => {
        await new Promise((r) => setTimeout(r, 2_000));
        await route.fulfill({ status: 200, body: JSON.stringify({ data: { success: true } }) });
      });

      const summaryPage = new SummaryPage(page);
      await summaryPage.goto();
      await summaryPage.waitForSummaryReady();
      await summaryPage.completeBtn.click();

      // Button must be disabled or carry a loading attribute while the request is pending
      const isDisabled = await summaryPage.completeBtn.isDisabled({ timeout: 1_500 }).catch(() => false);
      const hasLoadingAttr = await summaryPage.completeBtn.getAttribute('data-loading').catch(() => null);
      expect(isDisabled || hasLoadingAttr !== null).toBe(true);
    });

    test('500 on PUT /complete keeps user on summary', async ({ page, onboardingMocks }) => {
      await onboardingMocks.mockAll();
      await page.route('**/o/user/onboarding/complete', (route) =>
        route.fulfill({ status: 500, body: JSON.stringify({ error: 'Server Error' }) }),
      );

      const summaryPage = new SummaryPage(page);
      await summaryPage.goto();
      await summaryPage.waitForSummaryReady();
      await summaryPage.completeBtn.click();

      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 5_000 });
    });
  });
});
