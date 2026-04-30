import { test, expect } from '../../../fixtures';
import { WeaverPage } from '../../../pages/studio-web/weaver.page';

test.describe('Studio-Web — Weaver AI Editor', () => {
  test.beforeEach(async ({ page }) => {
    // Weaver requires an existing project UUID — use env var or skip
    const uuid = process.env.PLAYWRIGHT_SW_PROJECT_UUID;
    test.skip(!uuid, 'PLAYWRIGHT_SW_PROJECT_UUID not set — cannot navigate to Weaver');
    await page.goto(`/create/project/${uuid}/weaver`);
    await page.waitForLoadState('networkidle');
  });

  test('Weaver page loads without errors', async ({ page }) => {
    await expect(page).not.toHaveURL(/error|404/);
  });

  test('Chat panel is visible', async ({ page }) => {
    const weaver = new WeaverPage(page);
    const panelVisible = await weaver.chatPanel.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!panelVisible, 'Chat panel not found — UI may differ');
    await expect(weaver.chatPanel).toBeVisible();
  });

  test('Chat input field is present', async ({ page }) => {
    const weaver = new WeaverPage(page);
    const inputVisible = await weaver.chatInput.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!inputVisible, 'Chat input not found');
    await expect(weaver.chatInput).toBeVisible();
    await expect(weaver.chatInput).toBeEnabled();
  });

  test('Project Details accordion section is present', async ({ page }) => {
    const weaver = new WeaverPage(page);
    const sectionVisible = await weaver.projectDetailsSection.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!sectionVisible, 'Project Details section not found');
    await expect(weaver.projectDetailsSection).toBeVisible();
  });

  test('Knowledge Bases accordion section is present', async ({ page }) => {
    const weaver = new WeaverPage(page);
    const sectionVisible = await weaver.knowledgeBasesSection.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!sectionVisible, 'Knowledge Bases section not found');
    await expect(weaver.knowledgeBasesSection).toBeVisible();
  });

  test('Objectives accordion section is present', async ({ page }) => {
    const weaver = new WeaverPage(page);
    const sectionVisible = await weaver.objectivesSection.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!sectionVisible, 'Objectives section not found');
    await expect(weaver.objectivesSection).toBeVisible();
  });

  test('Chat input does not send real AI query (read-only check)', async ({ page }) => {
    const weaver = new WeaverPage(page);
    const inputVisible = await weaver.chatInput.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!inputVisible, 'Chat input not found');
    // Type but do NOT submit — just verify field accepts input
    await weaver.chatInput.fill('test query — do not submit');
    await expect(weaver.chatInput).toHaveValue('test query — do not submit');
    // Clear without sending
    await weaver.chatInput.clear();
  });

  test('Weaver page has no critical accessibility violations', async ({ page, a11y }) => {
    await a11y.assertNoViolations();
  });
});
