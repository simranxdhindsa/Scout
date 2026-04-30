import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

/**
 * Page object for /course/new (AddCourse component)
 *
 * Source: mission-control/src/features/course-studios/add-course.tsx
 * Fields: Name (TextInput), Level (Mantine Select), Description (RichText),
 *         Regular/AI Assistant/AI Instructor (Checkboxes), Authorize for all (Checkbox)
 * API: POST /a/course
 * On success: redirects to /course/{uuid}/overview
 */
export class CourseCreatePage extends BasePage {
  // Form fields — based on actual Mantine component labels
  readonly nameInput: Locator;
  readonly levelSelect: Locator;
  readonly descriptionEditor: Locator;
  readonly regularCheckbox: Locator;
  readonly aiAssistantCheckbox: Locator;
  readonly aiInstructorCheckbox: Locator;
  readonly authorizeAllCheckbox: Locator;

  // Buttons
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  // Feedback
  readonly successNotification: Locator;

  constructor(page: Page) {
    super(page);
    // Name: TextInput with label "Name"
    this.nameInput = page.getByLabel('Name');
    // Level: Mantine Select — clicking the .mantine-Select-input opens dropdown
    this.levelSelect = page.locator('.mantine-Select-input').first();
    // Description: RichText editor — contenteditable div inside .mantine-RichTextEditor-content
    this.descriptionEditor = page
      .locator('.ql-editor[contenteditable="true"]')
      .first();
    // Mode checkboxes — identified by their label text
    this.regularCheckbox = page.getByLabel('Regular');
    this.aiAssistantCheckbox = page.getByLabel('AI Assistant');
    this.aiInstructorCheckbox = page.getByLabel('AI Instructor');
    this.authorizeAllCheckbox = page.getByLabel(/enable this course to all/i);
    // Buttons
    this.submitButton = page.getByRole('button', { name: /^save$/i });
    this.cancelButton = page.getByRole('button', { name: /^cancel$/i });
    // Notification
    this.successNotification = page.locator('.mantine-Notification-root').filter({
      hasText: /details saved|saved|created/i,
    });
  }

  get path(): string { return '/course/new'; }

  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  async selectLevel(level: string): Promise<void> {
    await this.levelSelect.click();
    await this.page
      .locator('.mantine-Select-item, [role="option"]')
      .filter({ hasText: new RegExp(level, 'i') })
      .first()
      .click();
  }

  async fillDescription(text: string): Promise<void> {
    await this.descriptionEditor.click();
    await this.descriptionEditor.fill(text);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async getCourseUuidFromUrl(): Promise<string | null> {
    const url = this.page.url();
    const match = url.match(/\/course\/([a-f0-9-]{36})/);
    return match ? match[1] : null;
  }
}
