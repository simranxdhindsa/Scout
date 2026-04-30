import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class BookmarkPage extends BasePage {
  readonly courseCards: Locator;
  readonly emptyState: Locator;
  readonly removeBookmarkButtons: Locator;

  constructor(page: Page) {
    super(page);
    this.courseCards = page.locator('.mantine-Card-root');
    this.emptyState = page.locator('text=/no bookmark|aucun favori/i');
    this.removeBookmarkButtons = page.locator('[data-test="remove-bookmark"], [aria-label*="bookmark"]');
  }

  get path(): string { return '/bookmark'; }

  async removeFirstBookmark(): Promise<void> {
    await this.removeBookmarkButtons.first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async getBookmarkCount(): Promise<number> { return this.courseCards.count(); }
}
