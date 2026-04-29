import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class CourseDetailPage extends BasePage {
  readonly courseTitle: Locator;
  readonly courseDescription: Locator;
  readonly bannerImage: Locator;
  readonly progressBar: Locator;
  readonly levelBadge: Locator;
  readonly objectivesSection: Locator;
  readonly prerequisitesSection: Locator;
  readonly startButton: Locator;
  readonly resumeButton: Locator;
  readonly retakeButton: Locator;
  readonly assignButton: Locator;
  readonly bookmarkIcon: Locator;
  readonly backButton: Locator;
  readonly skillsSection: Locator;

  constructor(page: Page) {
    super(page);
    this.courseTitle = page.locator('h1, h2').first();
    this.courseDescription = page.locator('p').first();
    this.bannerImage = page.locator('[data-test="course-banner"], .course-banner img').first();
    this.progressBar = page.locator('[role="progressbar"], .mantine-Progress-root').first();
    this.levelBadge = page.locator('.mantine-Badge-root').first();
    this.objectivesSection = page.locator('[data-test="objectives"], text=/objectives|objectifs/i').first();
    this.prerequisitesSection = page.locator('[data-test="prerequisites"], text=/prerequisites|prérequis/i').first();
    this.startButton = page.getByRole('button', { name: /start|commencer|begin/i });
    this.resumeButton = page.getByRole('button', { name: /resume|reprendre|continue/i });
    this.retakeButton = page.getByRole('button', { name: /retake|recommencer/i });
    this.assignButton = page.getByRole('button', { name: /assign|assigner/i });
    this.bookmarkIcon = page.locator('[data-test="bookmark-icon"], [aria-label*="bookmark"]').first();
    this.backButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    this.skillsSection = page.locator('[data-test="skills-section"], text=/skills|compétences/i').first();
  }

  get path(): string { return '/courses'; }

  async isLoaded(): Promise<void> {
    await this.waitForLoadingToDisappear();
    await expect(this.courseTitle).toBeVisible({ timeout: 15_000 });
  }

  async startCourse(): Promise<void> {
    const btn = this.startButton.or(this.resumeButton);
    await btn.click();
    await this.page.waitForLoadState('networkidle');
  }
}
