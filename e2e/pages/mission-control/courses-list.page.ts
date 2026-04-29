import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class McCoursesListPage extends BasePage {
  readonly courseRows: Locator;
  readonly courseCards: Locator;
  readonly searchInput: Locator;
  readonly createCourseButton: Locator;
  readonly paginationNext: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.courseRows = page.locator('tr').filter({ has: page.locator('td') });
    this.courseCards = page.locator('.mantine-Card-root');
    this.searchInput = page.locator('input[type="text"], input[placeholder*="search" i]').first();
    this.createCourseButton = page.getByRole('button', { name: /create|add course|new course/i });
    this.paginationNext = page.locator('.mantine-ActionIcon-root').last();
    this.emptyState = page.locator('text=/no course|empty/i');
  }

  get path(): string { return '/courses'; }

  async searchCourses(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForLoadState('networkidle');
  }

  async getCount(): Promise<number> {
    const rows = await this.courseRows.count();
    const cards = await this.courseCards.count();
    return Math.max(rows, cards);
  }
}
