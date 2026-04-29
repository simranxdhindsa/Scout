import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class ProjectsListPage extends BasePage {
  readonly projectCards: Locator;
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly createProjectButton: Locator;
  readonly paginationNext: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.projectCards = page.locator('.mantine-Card-root');
    this.searchInput = page.locator('input[type="text"], input[placeholder*="search" i]').first();
    this.statusFilter = page.locator('.mantine-Select-input, [data-test="status-filter"]').first();
    this.createProjectButton = page.getByRole('button', { name: /create|add project|new project/i });
    this.paginationNext = page.locator('.mantine-ActionIcon-root').last();
    this.emptyState = page.locator('text=/no project|empty/i');
  }

  get path(): string { return '/projects'; }

  async getProjectCount(): Promise<number> { return this.projectCards.count(); }

  async clickFirstProject(): Promise<void> {
    await this.projectCards.first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async searchProjects(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForLoadState('networkidle');
  }
}
