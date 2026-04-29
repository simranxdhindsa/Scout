import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../shared/base.page';

export class AudioModelPage extends BasePage {
  readonly nextBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.nextBtn = page.getByRole('button', { name: /next|continue|suivant/i });
  }

  get path(): string { return '/onboarding/avatars'; }

  async goto(avatarId: string): Promise<void> {
    await this.page.goto(`/onboarding/avatars?tab=audio-model&avatarId=${avatarId}`);
    await this.waitForListReady();
  }

  // Audio model list — Mantine Table rows or Stack items containing model names
  get allItems(): Locator {
    return this.page.locator('.mantine-Table-tr, .mantine-Stack-root > *').filter({
      // Must contain a play or select action to be a real model row
      has: this.page.getByRole('button'),
    });
  }

  itemByName(name: string): Locator {
    return this.allItems.filter({ hasText: name });
  }

  // Play button inside a model row — does NOT assert audio plays (CI-safe)
  playBtnOf(name: string): Locator {
    return this.itemByName(name).getByRole('button', { name: /play|preview|écouter/i });
  }

  // Select / Choose button inside a model row
  selectBtnOf(name: string): Locator {
    return this.itemByName(name).getByRole('button', { name: /select|choose|choisir/i });
  }

  async waitForListReady(): Promise<void> {
    // Wait for at least one model row or the next button to appear
    await this.page.locator('.mantine-Table-root, .mantine-Stack-root').first()
      .waitFor({ state: 'visible', timeout: 10_000 });
  }

  async selectFirstModel(): Promise<void> {
    await this.waitForListReady();
    // Click the first Select button in the list
    await this.page.getByRole('button', { name: /select|choose|choisir/i }).first().click();
  }

  async selectModelByName(name: string): Promise<void> {
    await this.waitForListReady();
    await this.selectBtnOf(name).click();
  }

  async assertPlayBtnVisible(modelName: string): Promise<void> {
    await expect(this.playBtnOf(modelName)).toBeVisible();
  }

  async proceedToPreference(): Promise<void> {
    await this.nextBtn.click();
    await expect(this.page).toHaveURL(/\/onboarding\/preference/);
  }
}
