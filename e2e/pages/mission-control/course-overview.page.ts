import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class CourseOverviewPage extends BasePage {
  readonly courseTitle: Locator;
  readonly publishButton: Locator;
  readonly archiveButton: Locator;
  readonly deleteButton: Locator;
  readonly languagesTab: Locator;
  readonly sectionsTab: Locator;
  readonly authorizationsTab: Locator;
  readonly statusBadge: Locator;

  constructor(page: Page) {
    super(page);
    this.courseTitle = page.locator('h1, h2').first();
    this.publishButton = page.getByRole('button', { name: /publish/i });
    this.archiveButton = page.getByRole('button', { name: /archive/i });
    this.deleteButton = page.getByRole('button', { name: /delete/i });
    this.languagesTab = page.locator('[data-test="languages-tab"], a[href*="languages"]').first();
    this.sectionsTab = page.locator('[data-test="sections-tab"], a[href*="sections"]').first();
    this.authorizationsTab = page.locator('[data-test="authorizations-tab"], a[href*="authorization"]').first();
    this.statusBadge = page.locator('.mantine-Badge-root').first();
  }

  get path(): string { return '/courses'; }
}
