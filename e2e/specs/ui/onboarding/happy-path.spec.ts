import { test, expect } from '../../../fixtures';
import { AvatarsPage } from '../../../pages/ui/onboarding/avatars.page';
import { AudioModelPage } from '../../../pages/ui/onboarding/audio-model.page';
import { PreferencePage } from '../../../pages/ui/onboarding/preference.page';
import { TourPage } from '../../../pages/ui/onboarding/tour.page';
import { SummaryPage } from '../../../pages/ui/onboarding/summary.page';

test.describe('Onboarding — Happy Path', () => {
  let avatarsPage: AvatarsPage;
  let audioPage: AudioModelPage;
  let prefPage: PreferencePage;
  let tourPage: TourPage;
  let summaryPage: SummaryPage;

  test.beforeEach(async ({ page, onboardingMocks }) => {
    await onboardingMocks.mockAll();
    avatarsPage  = new AvatarsPage(page);
    audioPage    = new AudioModelPage(page);
    prefPage     = new PreferencePage(page);
    tourPage     = new TourPage(page);
    summaryPage  = new SummaryPage(page);
  });

  test('Step 1 — Avatar grid loads and shows selectable cards', async ({ page }) => {
    await avatarsPage.goto();
    await avatarsPage.waitForGridReady();

    await expect(avatarsPage.allCards.first()).toBeVisible();
    await expect(avatarsPage.nextBtn).toBeVisible();
  });

  test('Step 1 — Selecting a card enables the Next button', async ({ page }) => {
    await avatarsPage.goto();
    await avatarsPage.selectFirstCard();
    await expect(avatarsPage.nextBtn).toBeEnabled();
  });

  test('Step 2 — Audio-model tab loads after avatar selection', async ({ page }) => {
    await avatarsPage.goto();
    await avatarsPage.selectFirstCard();
    await avatarsPage.proceedToAudioTab();

    await audioPage.waitForListReady();
    await expect(audioPage.allItems.first()).toBeVisible();
  });

  test('Step 2 — Play button is rendered (CI-safe, no autoplay assertion)', async ({ page }) => {
    await audioPage.goto('avatar-1');
    await audioPage.waitForListReady();

    // Voice model names from mock must be visible
    await expect(page.getByText('Natural')).toBeVisible();
    // Play button must exist — clicking it (actual playback) is not asserted
    const playBtn = page.getByRole('button', { name: /play|preview|écouter/i }).first();
    await expect(playBtn).toBeVisible({ timeout: 5_000 });
  });

  test('Step 2 — Selecting an audio model enables Next', async ({ page }) => {
    await audioPage.goto('avatar-1');
    await audioPage.selectFirstModel();
    await expect(audioPage.nextBtn).toBeEnabled();
  });

  test('Step 3 — Preference page shows options', async ({ page }) => {
    await prefPage.goto();
    await prefPage.waitForOptionsReady();
    await expect(prefPage.allOptions.first()).toBeVisible();
  });

  test('Step 3 — Selecting a preference enables Next', async ({ page }) => {
    await prefPage.goto();
    await prefPage.selectFirstOption();
    await expect(prefPage.nextBtn).toBeEnabled();
  });

  test('Step 4 — Tour container is visible', async ({ page }) => {
    await tourPage.goto();
    await tourPage.waitForContainerReady();
    await expect(tourPage.container).toBeVisible();
  });

  test('Step 5 — Interest chips are selectable', async ({ page }) => {
    await page.goto('/onboarding/tour/interests');
    await tourPage.waitForInterestsReady();

    await expect(tourPage.allInterestChips.first()).toBeVisible();
    // Click first chip — it should toggle to selected state
    const firstChip = tourPage.allInterestChips.first();
    await firstChip.click();
    // Mantine Chip root receives data-checked="true" when selected
    await expect(firstChip).toHaveAttribute('data-checked', 'true');
  });

  test('Step 6 — Summary shows complete button', async ({ page }) => {
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();
    await expect(summaryPage.completeBtn).toBeVisible();
  });

  test('Step 6 — Complete button fires PUT /complete and redirects to /dashboard', async ({ page }) => {
    let completeCalled = false;
    // Register before goto so it captures the request; Playwright routes LIFO so this wins over mockAll's route
    await page.route('**/o/user/onboarding/complete', async (route) => {
      completeCalled = route.request().method() === 'PUT';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { success: true } }) });
    });

    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();
    await expect(page.getByText("You're all set!")).toBeVisible();
    await summaryPage.complete();

    expect(completeCalled).toBe(true);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('Full happy path — avatar → audio → preference → tour → interests → summary → complete', async ({ page }) => {
    // 1. Avatars
    await avatarsPage.goto();
    await avatarsPage.selectFirstCard();
    await avatarsPage.proceedToAudioTab();

    // 2. Audio model
    await expect(page).toHaveURL(/tab=audio-model/);
    await audioPage.waitForListReady();
    await audioPage.selectFirstModel();
    await audioPage.nextBtn.click();

    // 3. Preference
    await expect(page).toHaveURL(/\/onboarding\/preference/);
    await prefPage.waitForOptionsReady();
    await prefPage.selectFirstOption();
    await prefPage.nextBtn.click();

    // 4–5. Tour + interests
    await expect(page).toHaveURL(/\/onboarding\/tour/);
    await tourPage.walkThroughTour();

    // 6. Summary
    await expect(page).toHaveURL(/\/onboarding\/summary/);
    await summaryPage.waitForSummaryReady();
    await summaryPage.complete();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
