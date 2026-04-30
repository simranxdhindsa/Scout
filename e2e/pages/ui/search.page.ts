import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class SearchPage extends BasePage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly languageSelect: Locator;
  readonly courseCards: Locator;
  readonly noResults: Locator;
  readonly gridToggle: Locator;
  readonly listToggle: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.locator('input[type="text"]').first();
    this.searchButton = page.getByRole('button', { name: /search|rechercher/i });
    this.languageSelect = page.locator('.mantine-Select-input').first();
    this.courseCards = page.locator('.mantine-Card-root');
    this.noResults = page.locator('text=/no results|aucun résultat/i');
    this.gridToggle = page.locator('[data-test="grid-toggle"], [aria-label*="grid"]').first();
    this.listToggle = page.locator('[data-test="list-toggle"], [aria-label*="list"]').first();
  }

  get path(): string { return '/search'; }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getResultCount(): Promise<number> { return this.courseCards.count(); }
}
