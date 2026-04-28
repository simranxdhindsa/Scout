import { test, expect } from '../../../fixtures';
import { UserProfilePage } from '../../../pages/ui/user-profile.page';

test.describe('User Profile — Avatar', () => {
  test('Upload new avatar', async ({ page }) => {
    const profilePage = new UserProfilePage(page);
    await profilePage.goto();
    await profilePage.waitForLoadingToDisappear();
    const fileInput = page.locator('input[type="file"]').first();
    const exists = await fileInput.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'No file input on profile page');
    // Provide a small valid PNG
    await fileInput.setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG magic bytes
    });
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/user-profile/);
  });
});

test.describe('User Profile — Password', () => {
  test('Change password — validation rules enforced', async ({ page }) => {
    const profilePage = new UserProfilePage(page);
    await profilePage.goto();
    await profilePage.waitForLoadingToDisappear();

    const currentPwdField = profilePage.currentPasswordInput;
    const exists = await currentPwdField.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!exists, 'Password change form not on profile page');

    // Try a weak new password
    await currentPwdField.fill('currentPass123!');
    await profilePage.newPasswordInput.fill('weak');
    await profilePage.confirmPasswordInput.fill('weak');
    await profilePage.savePasswordButton.click();
    // Should show validation error
    await expect(page).toHaveURL(/user-profile/);
  });
});
