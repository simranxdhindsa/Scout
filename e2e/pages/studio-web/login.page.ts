import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class SwLoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.locator('[data-test="email-input"], input[type="email"]').first();
    this.passwordInput = page.locator('[data-test="password-input"], input[type="password"]').first();
    this.submitButton = page.locator('button[type="submit"]');
    this.errorAlert = page.locator('.mantine-Alert-root, [data-test="login-error"]').first();
  }

  get path(): string { return '/auth/signIn'; }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async isCredFormVisible(): Promise<boolean> {
    return this.emailInput.isVisible({ timeout: 3_000 }).catch(() => false);
  }
}
