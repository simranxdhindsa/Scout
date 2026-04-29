import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../shared/base.page';

export class SummaryPage extends BasePage {
  readonly completeBtn: Locator;

  constructor(page: Page) {
    super(page);
    // "Complete", "Finish", "Start", "Get started" — pick up whichever the app uses
    this.completeBtn = page.getByRole('button', {
      name: /complete|finish|start|get started|terminer|commencer/i,
    });
  }

  get path(): string { return '/onboarding/summary'; }

  // Summary page renders a review card or article — wait for any visible heading
  get summaryHeading(): Locator {
    return this.page.getByRole('heading').first();
  }

  // Edit links — the summary shows anchor/button links to go back and change selections
  get editAvatarLink(): Locator {
    return this.page.getByRole('link', { name: /edit|change|avatar|modifier/i })
      .or(this.page.getByRole('button', { name: /edit|change|avatar|modifier/i }))
      .first();
  }

  get editAudioLink(): Locator {
    return this.page.getByRole('link', { name: /edit|change|audio|voice|modifier/i })
      .or(this.page.getByRole('button', { name: /edit|change|audio|voice|modifier/i }))
      .nth(1); // second edit control = audio (avatar is first)
  }

  async waitForSummaryReady(): Promise<void> {
    await this.summaryHeading.waitFor({ state: 'visible', timeout: 10_000 });
    await this.completeBtn.waitFor({ state: 'visible', timeout: 10_000 });
  }

  async editAvatar(): Promise<void> {
    await this.editAvatarLink.click();
    await expect(this.page).toHaveURL(/\/onboarding\/avatars.*redirect=summary/);
  }

  async editAudio(): Promise<void> {
    await this.editAudioLink.click();
    await expect(this.page).toHaveURL(/tab=audio-model.*redirect=summary/);
  }

  async complete(): Promise<void> {
    await this.completeBtn.click();
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  }
}
