import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class UserProfilePage extends BasePage {
  readonly avatarUploadButton: Locator;
  readonly currentPasswordInput: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly savePasswordButton: Locator;

  constructor(page: Page) {
    super(page);
    this.avatarUploadButton = page.locator('[data-test="avatar-upload"], input[type="file"]').first();
    this.currentPasswordInput = page.locator('input[type="password"]').nth(0);
    this.newPasswordInput = page.locator('input[type="password"]').nth(1);
    this.confirmPasswordInput = page.locator('input[type="password"]').nth(2);
    this.savePasswordButton = page.getByRole('button', { name: /save|enregistrer/i }).first();
  }

  get path(): string { return '/user-profile'; }
}
