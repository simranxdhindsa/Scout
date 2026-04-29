import { test, expect } from '../../../fixtures';
import { AvatarsPage } from '../../../pages/ui/onboarding/avatars.page';
import { AudioModelPage } from '../../../pages/ui/onboarding/audio-model.page';
import { SummaryPage } from '../../../pages/ui/onboarding/summary.page';

test.describe('Onboarding — redirect=summary edit flow', () => {
  let avatarsPage: AvatarsPage;
  let audioPage: AudioModelPage;
  let summaryPage: SummaryPage;

  test.beforeEach(async ({ page, onboardingMocks }) => {
    await onboardingMocks.mockAll();
    avatarsPage  = new AvatarsPage(page);
    audioPage    = new AudioModelPage(page);
    summaryPage  = new SummaryPage(page);
  });

  test.describe('Edit avatar from summary', () => {
    test('Edit avatar link navigates to /onboarding/avatars?redirect=summary', async ({ page }) => {
      await summaryPage.goto();
      await summaryPage.waitForSummaryReady();
      await summaryPage.editAvatar();

      await expect(page).toHaveURL(/\/onboarding\/avatars.*redirect=summary/);
    });

    test('Selecting a card in redirect=summary mode returns to summary', async ({ page }) => {
      await page.goto('/onboarding/avatars?redirect=summary');
      await avatarsPage.waitForGridReady();

      await avatarsPage.selectFirstCard();
      await avatarsPage.nextBtn.click();

      await expect(page).toHaveURL(/\/onboarding\/summary/);
    });

    test('PUT avatar is called when a card is saved from redirect=summary', async ({ page }) => {
      let putAvatarCalled = false;
      await page.route('**/o/user/onboarding/avatar/**', async (route) => {
        if (route.request().method() === 'PUT') putAvatarCalled = true;
        await route.fulfill({ status: 200, body: JSON.stringify({ data: { success: true } }) });
      });

      await page.goto('/onboarding/avatars?redirect=summary');
      await avatarsPage.waitForGridReady();
      await avatarsPage.selectFirstCard();
      await avatarsPage.nextBtn.click();

      expect(putAvatarCalled).toBe(true);
    });
  });

  test.describe('Edit audio model from summary', () => {
    test('Edit audio link navigates to audio-model tab with redirect=summary', async ({ page }) => {
      await summaryPage.goto();
      await summaryPage.waitForSummaryReady();
      await summaryPage.editAudio();

      await expect(page).toHaveURL(/tab=audio-model.*redirect=summary/);
    });

    test('Selecting a model in redirect=summary mode returns to summary', async ({ page }) => {
      await page.goto('/onboarding/avatars?tab=audio-model&avatarId=avatar-1&redirect=summary');
      await audioPage.waitForListReady();
      await audioPage.selectFirstModel();
      await audioPage.nextBtn.click();

      await expect(page).toHaveURL(/\/onboarding\/summary/);
    });

    test('PUT audio model is called when saved from redirect=summary', async ({ page }) => {
      let putAudioCalled = false;
      await page.route('**/o/user/onboarding/audio-model/**', async (route) => {
        if (route.request().method() === 'PUT') putAudioCalled = true;
        await route.fulfill({ status: 200, body: JSON.stringify({ data: { success: true } }) });
      });

      await page.goto('/onboarding/avatars?tab=audio-model&avatarId=avatar-1&redirect=summary');
      await audioPage.waitForListReady();
      await audioPage.selectFirstModel();
      await audioPage.nextBtn.click();

      expect(putAudioCalled).toBe(true);
    });
  });

  test('Full redirect=summary round-trip: edit avatar → back to summary → complete', async ({ page }) => {
    await summaryPage.goto();
    await summaryPage.waitForSummaryReady();

    // Edit avatar
    await summaryPage.editAvatar();
    await expect(page).toHaveURL(/redirect=summary/);

    // Select a card and save
    await avatarsPage.waitForGridReady();
    await avatarsPage.selectFirstCard();
    await avatarsPage.nextBtn.click();

    // Back at summary
    await expect(page).toHaveURL(/\/onboarding\/summary/);
    await summaryPage.waitForSummaryReady();

    // Complete onboarding
    await summaryPage.complete();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
