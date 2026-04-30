import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class DashboardPage extends BasePage {
  readonly heading: Locator;
  readonly individualTab: Locator;
  readonly managerTab: Locator;
  readonly assignedCoursesSection: Locator;
  readonly completedCoursesSection: Locator;
  readonly skillsSection: Locator;
  readonly courseCards: Locator;
  readonly carouselNextBtn: Locator;
  readonly carouselPrevBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('h1').first();
    this.individualTab = page.locator('[data-test="individual-tab"], [value="individual"]').first();
    this.managerTab = page.locator('[data-test="manager-tab"], [value="manager"]').first();
    this.assignedCoursesSection = page.locator('[data-test="assigned-courses"]');
    this.completedCoursesSection = page.locator('[data-test="completed-courses"]');
    this.skillsSection = page.locator('[data-test="skills-section"]');
    this.courseCards = page.locator('.mantine-Card-root');
    this.carouselNextBtn = page.locator('[data-test="carousel-next"], .mantine-Carousel-control').last();
    this.carouselPrevBtn = page.locator('[data-test="carousel-prev"], .mantine-Carousel-control').first();
  }

  get path(): string { return '/dashboard'; }
}
