import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class LoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;
  readonly forgotPasswordLink: Locator;
  readonly returnToHomepageLink: Locator;
  readonly ssoButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.locator('[data-test="email-input"]');
    this.passwordInput = page.locator('[data-test="password-input"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.errorAlert = page.locator('[data-test="login-error-alert"]');
    this.forgotPasswordLink = page.locator('a').filter({ hasText: /forgot password/i });
    this.returnToHomepageLink = page.locator('a').filter({ hasText: /return to homepage/i });
    this.ssoButtons = page.locator('[data-test="sso-button"], button').filter({ hasText: /google|microsoft|sso/i });
  }

  get path(): string { return '/auth/signIn'; }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async assertErrorVisible(): Promise<void> {
    await this.errorAlert.waitFor({ state: 'visible', timeout: 10_000 });
  }

  async isCredFormVisible(): Promise<boolean> {
    return this.emailInput.isVisible({ timeout: 3_000 }).catch(() => false);
  }
}
