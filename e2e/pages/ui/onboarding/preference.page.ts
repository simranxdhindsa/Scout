import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../shared/base.page';

export class PreferencePage extends BasePage {
  readonly nextBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.nextBtn = page.getByRole('button', { name: /next|continue|suivant/i });
  }

  get path(): string { return '/onboarding/preference'; }

  // Preference options are typically Mantine SegmentedControl, Radio.Group, or styled cards.
  // We target by role first, falling back to the Mantine chip/radio wrappers.
  get allOptions(): Locator {
    return this.page.getByRole('radio').or(
      this.page.locator('.mantine-SegmentedControl-label, .mantine-Chip-label'),
    );
  }

  optionByText(text: string | RegExp): Locator {
    return this.page.getByRole('radio', { name: text }).or(
      this.page.locator('.mantine-SegmentedControl-label, .mantine-Chip-label')
        .filter({ hasText: text }),
    );
  }

  async waitForOptionsReady(): Promise<void> {
    await this.allOptions.first().waitFor({ state: 'visible', timeout: 10_000 });
  }

  async selectOption(text: string | RegExp): Promise<void> {
    await this.waitForOptionsReady();
    await this.optionByText(text).click();
  }

  async selectFirstOption(): Promise<void> {
    await this.waitForOptionsReady();
    await this.allOptions.first().click();
  }

  async proceedToTour(): Promise<void> {
    await this.nextBtn.click();
    await expect(this.page).toHaveURL(/\/onboarding\/tour/);
  }
}
