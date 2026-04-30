import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class ProjectCreatePage extends BasePage {
  readonly nameInput: Locator;
  readonly modeSelect: Locator;
  readonly languageSelect: Locator;
  readonly submitButton: Locator;
  // Step 2 — basic info
  readonly titleInput: Locator;
  readonly descriptionEditor: Locator;
  readonly typeControl: Locator;
  readonly levelControl: Locator;
  readonly step2SubmitButton: Locator;

  constructor(page: Page) {
    super(page);
    // Step 1 — project creation
    this.nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();
    this.modeSelect = page.locator('.mantine-Select-input').nth(0);
    this.languageSelect = page.locator('.mantine-Select-input').nth(1);
    this.submitButton = page.getByRole('button', { name: /create|save|next/i }).first();
    // Step 2 — course details
    this.titleInput = page.locator('input[name="title"], input[placeholder*="title" i]').first();
    this.descriptionEditor = page.locator('[contenteditable="true"], .mantine-RichTextEditor-content').first();
    this.typeControl = page.locator('.mantine-SegmentedControl-root').first();
    this.levelControl = page.locator('.mantine-SegmentedControl-root').nth(1);
    this.step2SubmitButton = page.getByRole('button', { name: /save|next|continue/i }).first();
  }

  get path(): string { return '/project/new'; }

  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  async getProjectUuidFromUrl(): Promise<string | null> {
    const url = this.page.url();
    const match = url.match(/project\/([a-f0-9-]{36})/);
    return match ? match[1] : null;
  }
}
