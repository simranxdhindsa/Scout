import { Page, Locator } from '@playwright/test';

export class SidebarPage {
  readonly page: Page;
  readonly dashboardLink: Locator;
  readonly skillsDashboardLink: Locator;
  readonly manageCoursesLink: Locator;
  readonly coursesLink: Locator;
  readonly bookmarkLink: Locator;
  readonly administrationLink: Locator;
  readonly adminUsersLink: Locator;
  readonly adminTeamsLink: Locator;
  readonly adminBrandingLink: Locator;
  readonly adminUserAttributesLink: Locator;
  readonly adminSkillsLink: Locator;
  readonly adminJobRolesLink: Locator;
  readonly userMenu: Locator;
  readonly logoLink: Locator;
  readonly studioLink: Locator;
  readonly languageIcon: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dashboardLink = page.locator('a[href="/dashboard"]');
    this.skillsDashboardLink = page.locator('a[href="/skills-dashboard"]');
    this.manageCoursesLink = page.locator('a[href="/manage-courses"]');
    this.coursesLink = page.locator('a[href*="/courses"]').first();
    this.bookmarkLink = page.locator('a[href="/bookmark"]');
    this.administrationLink = page.locator('a[href="/administration"]');
    this.adminUsersLink = page.locator('a[href="/administration/users"]');
    this.adminTeamsLink = page.locator('a[href="/administration/teams"]');
    this.adminBrandingLink = page.locator('a[href="/administration/branding"]');
    this.adminUserAttributesLink = page.locator('a[href="/administration/user-attributes"]');
    this.adminSkillsLink = page.locator('a[href="/administration/skills"]');
    this.adminJobRolesLink = page.locator('a[href="/administration/job-roles"]');
    this.userMenu = page.locator('.mantine-Avatar-root').last();
    this.logoLink = page.locator('a[href="/dashboard"] img').first();
    this.studioLink = page.locator('a[href*="studio"]').first();
    this.languageIcon = page.locator('[data-test="language-icon"], [aria-label*="language"]').first();
  }

  async navigateTo(link: Locator): Promise<void> {
    await link.click();
    await this.page.waitForLoadState('networkidle');
  }

  async logout(): Promise<void> {
    await this.userMenu.click();
    await this.page.getByText(/logout|déconnexion|sign out/i).click();
  }

  async goToUserProfile(): Promise<void> {
    await this.userMenu.click();
    await this.page.locator('a[href="/user-profile"]').click();
    await this.page.waitForLoadState('networkidle');
  }
}
