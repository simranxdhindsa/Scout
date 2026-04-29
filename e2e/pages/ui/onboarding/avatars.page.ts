import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../shared/base.page';

export class AvatarsPage extends BasePage {
  // Mantine Skeleton covers the grid while avatars are loading
  readonly skeleton: Locator;
  // Next / Continue button — text varies by locale but always a submit-style button
  readonly nextBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.skeleton = page.locator('.mantine-Skeleton-root');
    // Matches "Next", "Continue", "Suivant", etc. — broadened intentionally
    this.nextBtn  = page.getByRole('button', { name: /next|continue|suivant/i });
  }

  get path(): string { return '/onboarding/avatars'; }

  // Avatar cards are rendered as clickable images or cards inside a grid.
  // We target the image wrappers since each avatar has a visible image.
  get allCards(): Locator {
    return this.page.locator('.mantine-Image-root, .mantine-Avatar-root').locator('visible=true');
  }

  // Cards can also be selected by their visible name text when available
  cardByName(name: string): Locator {
    return this.page.locator('.mantine-Card-root, .mantine-UnstyledButton-root')
      .filter({ hasText: name });
  }

  // Empty-state: any element containing typical "no avatar" phrasing
  get emptyState(): Locator {
    return this.page.locator('text=/no avatar|aucun avatar|not available/i');
  }

  async waitForGridReady(): Promise<void> {
    // Wait for skeletons to clear
    await this.page.waitForFunction(
      () => document.querySelectorAll('.mantine-Skeleton-root').length === 0,
      { timeout: 15_000 },
    );
    // At least one card or the empty state must be visible
    await expect(
      this.allCards.first().or(this.emptyState),
    ).toBeVisible({ timeout: 10_000 });
  }

  async selectFirstCard(): Promise<void> {
    await this.waitForGridReady();
    await this.allCards.first().click();
  }

  async selectCardByName(name: string): Promise<void> {
    await this.waitForGridReady();
    await this.cardByName(name).click();
  }

  async assertEmptyState(): Promise<void> {
    await this.emptyState.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(this.nextBtn).toBeDisabled();
  }

  async proceedToAudioTab(): Promise<void> {
    await this.nextBtn.click();
    await expect(this.page).toHaveURL(/tab=audio-model/);
  }
}
