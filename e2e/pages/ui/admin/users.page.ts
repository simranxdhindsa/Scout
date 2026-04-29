import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../shared/base.page';

export class AdminUsersPage extends BasePage {
  readonly addUserButton: Locator;
  readonly uploadCsvButton: Locator;
  readonly searchInput: Locator;
  readonly userRows: Locator;
  readonly modal: Locator;
  readonly modalEmailInput: Locator;
  readonly modalLanguageSelect: Locator;
  readonly modalSaveButton: Locator;
  readonly modalCancelButton: Locator;
  readonly paginationNext: Locator;

  constructor(page: Page) {
    super(page);
    this.addUserButton = page.getByRole('button', { name: /add user|ajouter/i });
    this.uploadCsvButton = page.getByRole('button', { name: /upload|importer|csv/i });
    this.searchInput = page.locator('input[type="text"]').first();
    this.userRows = page.locator('tr').filter({ has: page.locator('td') });
    this.paginationNext = page.locator('.mantine-ActionIcon-root').last();
    this.modal = page.locator('.mantine-Modal-root');
    this.modalEmailInput = this.modal.locator('input').first();
    this.modalLanguageSelect = this.modal.locator('.mantine-Select-input');
    this.modalSaveButton = this.modal.getByRole('button', { name: /save|enregistrer/i });
    this.modalCancelButton = this.modal.getByRole('button', { name: /cancel|annuler/i });
  }

  get path(): string { return '/administration/users'; }

  async openAddUserModal(): Promise<void> {
    await this.addUserButton.click();
    await this.modal.waitFor({ state: 'visible' });
  }

  async searchUsers(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }

  async getUserCount(): Promise<number> { return this.userRows.count(); }
}
