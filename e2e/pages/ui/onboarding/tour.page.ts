import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../shared/base.page';

export class TourPage extends BasePage {
  readonly nextBtn: Locator;
  readonly skipBtn: Locator;

  // Interests sub-page
  readonly interestsSubmitBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.nextBtn           = page.getByRole('button', { name: /next|continue|suivant/i });
    this.skipBtn           = page.getByRole('button', { name: /skip|passer/i });
    this.interestsSubmitBtn = page.getByRole('button', { name: /next|continue|done|suivant|terminer/i });
  }

  get path(): string { return '/onboarding/tour'; }

  // Tour container — a main section or article wrapping the tour content
  get container(): Locator {
    return this.page.locator('main, [role="main"], section').first();
  }

  // Interests are rendered as Mantine Chip components (checkbox-backed toggles)
  get allInterestChips(): Locator {
    return this.page.locator('.mantine-Chip-root, .mantine-Badge-root[role="button"]');
  }

  interestByText(text: string | RegExp): Locator {
    return this.allInterestChips.filter({ hasText: text });
  }

  async waitForContainerReady(): Promise<void> {
    await this.container.waitFor({ state: 'visible', timeout: 10_000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  }

  async waitForInterestsReady(): Promise<void> {
    await this.allInterestChips.first().waitFor({ state: 'visible', timeout: 10_000 });
  }

  async clickNext(): Promise<void> {
    await this.nextBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await this.nextBtn.click();
  }

  async selectInterestByText(text: string | RegExp): Promise<void> {
    await this.waitForInterestsReady();
    await this.interestByText(text).click();
  }

  async selectInterestsByText(texts: Array<string | RegExp>): Promise<void> {
    await this.waitForInterestsReady();
    for (const text of texts) {
      await this.interestByText(text).click();
    }
  }

  async submitInterests(): Promise<void> {
    await this.interestsSubmitBtn.click();
    await expect(this.page).toHaveURL(/\/onboarding\/(summary|tour)/);
  }

  // Advances through avatar → audio → text tour steps then handles interests
  async walkThroughTour(interestTexts: Array<string | RegExp> = []): Promise<void> {
    await this.waitForContainerReady();

    // Click Next through each sub-step until we reach interests or summary
    while (true) {
      const url = this.page.url();
      if (url.includes('/tour/interests') || url.includes('/summary')) break;

      const nextVisible = await this.nextBtn.isVisible({ timeout: 2_000 }).catch(() => false);
      if (!nextVisible) break;
      await this.clickNext();
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    // Interests step
    const onInterests = this.page.url().includes('/tour/interests');
    if (onInterests && interestTexts.length > 0) {
      await this.selectInterestsByText(interestTexts);
      await this.submitInterests();
    }
  }
}
