import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class CoursesPage extends BasePage {
  readonly assignedTab: Locator;
  readonly completedTab: Locator;
  readonly availableTab: Locator;
  readonly courseCards: Locator;
  readonly paginationNext: Locator;
  readonly paginationPrev: Locator;
  readonly pageInfo: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page);
    this.assignedTab = page.locator('[value="assigned-courses"]');
    this.completedTab = page.locator('[value="completed-courses"]');
    this.availableTab = page.locator('[value="available-courses"]');
    this.courseCards = page.locator('.mantine-Card-root');
    this.paginationNext = page.locator('.mantine-ActionIcon-root').filter({ has: page.locator('svg') }).last();
    this.paginationPrev = page.locator('.mantine-ActionIcon-root').filter({ has: page.locator('svg') }).first();
    this.pageInfo = page.locator('text=/Page \\d+ of \\d+/i');
    this.emptyState = page.locator('[data-test="empty-state"], text=/no courses|aucun cours/i');
  }

  get path(): string { return '/courses?tab=assigned-courses'; }

  async switchToTab(tab: 'assigned' | 'completed' | 'available'): Promise<void> {
    const map = { assigned: this.assignedTab, completed: this.completedTab, available: this.availableTab };
    await map[tab].click();
    await this.page.waitForLoadState('networkidle');
  }

  async getCourseCount(): Promise<number> { return this.courseCards.count(); }

  async clickFirstCourse(): Promise<void> {
    await this.courseCards.first().click();
    await this.page.waitForLoadState('networkidle');
  }

  async goToNextPage(): Promise<void> {
    await this.paginationNext.click();
    await this.page.waitForLoadState('networkidle');
  }
}
