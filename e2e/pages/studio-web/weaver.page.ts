import { Page, Locator } from '@playwright/test';
import { BasePage } from '../shared/base.page';

export class WeaverPage extends BasePage {
  readonly chatPanel: Locator;
  readonly chatInput: Locator;
  readonly accordion: Locator;
  readonly projectDetailsSection: Locator;
  readonly knowledgeBasesSection: Locator;
  readonly teaserSection: Locator;
  readonly objectivesSection: Locator;

  constructor(page: Page) {
    super(page);
    this.chatPanel = page.locator('[data-test="chat-panel"], [class*="chat"]').first();
    this.chatInput = page.locator('[data-test="chat-input"], [placeholder*="ask" i], [placeholder*="message" i]').first();
    this.accordion = page.locator('.mantine-Accordion-root').first();
    this.projectDetailsSection = page.locator('.mantine-Accordion-item').filter({ hasText: /project details/i }).first();
    this.knowledgeBasesSection = page.locator('.mantine-Accordion-item').filter({ hasText: /knowledge base/i }).first();
    this.teaserSection = page.locator('.mantine-Accordion-item').filter({ hasText: /teaser/i }).first();
    this.objectivesSection = page.locator('.mantine-Accordion-item').filter({ hasText: /objectives/i }).first();
  }

  get path(): string { return '/projects'; }
}
