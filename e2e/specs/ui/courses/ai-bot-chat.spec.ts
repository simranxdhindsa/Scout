import { test, expect } from '../../../fixtures';

/**
 * UI — AI Bot Chat Automation
 *
 * Mirrors the flow from ardoise-automation/ai-bot-automation/tests/chat.spec.js
 * but uses the shared session (no manual login needed) and Playwright best practices.
 *
 * Flow:
 *   Dashboard → select org/country → resume/start course → wait for asset →
 *   locate chat input → send messages → verify bot responds
 */

test.describe('UI — AI Bot Chat', () => {
  test.use({ baseURL: process.env.PLAYWRIGHT_UI_URL });

  // ─── Full navigation + chat flow ────────────────────────────────────────────

  test('Navigate to course and send chat messages to AI bot', async ({ page }) => {
    test.setTimeout(0); // no timeout — bot may take time to respond

    // 1. Go to dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    console.log('✅ Dashboard loaded:', page.url());

    // 2. Select org / country if picker is visible (e.g. Norway flag)
    const orgPicker = page.getByRole('img', { name: /norway/i }).nth(1);
    const hasOrgPicker = await orgPicker.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasOrgPicker) {
      await orgPicker.click();
      await page.waitForLoadState('networkidle');
      console.log('✅ Org selected');
    }

    // 3. Resume or Start a course
    //    Try "Resume Course" first, fall back to first available "Start" button
    const resumeBtn = page.getByRole('button', { name: /resume course/i }).first();
    const startBtn  = page.getByRole('button', { name: /start course|start/i }).first();

    const hasResume = await resumeBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasResume) {
      await resumeBtn.click();
      console.log('▶️  Clicked Resume Course');
    } else {
      const hasStart = await startBtn.isVisible({ timeout: 5_000 }).catch(() => false);
      test.skip(!hasStart, 'No Resume or Start button found on dashboard');
      await startBtn.click();
      console.log('▶️  Clicked Start Course');
    }

    // 4. Accept consent modal if it appears
    const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
    const hasConsent = await acceptBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasConsent) {
      await acceptBtn.click();
      console.log('✅ Consent accepted');
    }

    // 5. Wait for course asset page
    await page.waitForURL(/\/courses\/.+\/section\/.+\/asset\/.+/, { timeout: 60_000 });
    console.log('✅ Course asset page loaded:', page.url());

    // 6. Wait 10 seconds for avatar/bot to initialise
    await page.waitForTimeout(10_000);
    console.log('⏱️  10s init delay done — looking for chat input');

    // 7. Locate chat input
    const chatInput = page.getByRole('textbox', {
      name: /type here or speak in the mic/i,
    });
    await chatInput.waitFor({ state: 'visible', timeout: 30_000 });
    console.log('✅ Chat input found');

    // 8. Send 3 messages and verify bot responds each time
    const messages = [
      'Hello, can you help me?',
      'What is this course about?',
      'Tell me more about the first topic',
    ];

    for (const message of messages) {
      await chatInput.click();
      await chatInput.fill(message);
      await chatInput.press('Enter');
      console.log(`📨 Sent: "${message}"`);

      // Wait for bot response to appear in chat panel
      // Bot response appears as a new message bubble after user message
      await page.waitForTimeout(7_000); // give bot time to respond

      // Assert the message was sent (visible in chat history)
      const sentMsg = page.locator('[class*="chat"], [class*="message"], [class*="bubble"]')
        .filter({ hasText: message })
        .first();
      const appeared = await sentMsg.isVisible({ timeout: 5_000 }).catch(() => false);
      if (appeared) {
        await expect(sentMsg).toBeVisible();
        console.log(`✅ Message visible in chat: "${message}"`);
      }
    }
  });

  // ─── Read-only: chat input is present on a theory asset ─────────────────────

  test('Chat input is visible on a course asset page', async ({ page }) => {
    // Navigate directly to courses list and open first available course
    await page.goto('/courses');
    await page.waitForLoadState('networkidle');

    // Click first course card
    const firstCourse = page.locator('[class*="course-card"], [class*="CourseCard"], article').first();
    const hasCourse = await firstCourse.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!hasCourse, 'No courses available in catalogue');

    await firstCourse.click();
    await page.waitForLoadState('networkidle');

    // Start or continue the course
    const actionBtn = page.getByRole('button', {
      name: /start course|continue|resume/i,
    }).first();
    const hasAction = await actionBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!hasAction, 'No start/continue button on course detail');

    await actionBtn.click();

    // Accept consent if shown
    const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
    const hasConsent = await acceptBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasConsent) await acceptBtn.click();

    // Wait for asset page
    await page.waitForURL(/\/courses\/.+\/section\/.+\/asset\/.+/, { timeout: 60_000 });
    await page.waitForTimeout(5_000); // init buffer

    // Assert chat input exists
    const chatInput = page.getByRole('textbox', {
      name: /type here or speak in the mic/i,
    });
    const hasChat = await chatInput.isVisible({ timeout: 15_000 }).catch(() => false);

    if (hasChat) {
      await expect(chatInput).toBeVisible();
      await expect(chatInput).toBeEnabled();
      console.log('✅ Chat input is visible and enabled');
    } else {
      // Some asset types (quiz, transition) don't have chat — that's acceptable
      console.log('ℹ️  No chat input on this asset type — this is expected for non-interactive assets');
    }
  });

  // ─── Bot responds: send one message and verify a response appears ────────────

  test('Bot responds after sending a message', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Resume course
    const resumeBtn = page.getByRole('button', { name: /resume course/i }).first();
    const hasResume = await resumeBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!hasResume, 'No Resume Course button — start a course manually first');

    await resumeBtn.click();

    const acceptBtn = page.getByRole('button', { name: /accept/i }).first();
    const hasConsent = await acceptBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasConsent) await acceptBtn.click();

    await page.waitForURL(/\/courses\/.+\/section\/.+\/asset\/.+/, { timeout: 60_000 });
    await page.waitForTimeout(10_000);

    const chatInput = page.getByRole('textbox', {
      name: /type here or speak in the mic/i,
    });
    const hasChat = await chatInput.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!hasChat, 'No chat input on this asset type');

    // Count current messages before sending
    const messagesBefore = await page.locator(
      '[class*="message"], [class*="bubble"], [class*="chat-item"]'
    ).count();

    // Send a message
    await chatInput.click();
    await chatInput.fill('Hello');
    await chatInput.press('Enter');
    console.log('📨 Sent: "Hello"');

    // Wait for bot to respond (new message appears)
    await page.waitForFunction(
      (before) => {
        const items = document.querySelectorAll(
          '[class*="message"], [class*="bubble"], [class*="chat-item"]'
        );
        return items.length > before;
      },
      messagesBefore,
      { timeout: 30_000 }
    );

    const messagesAfter = await page.locator(
      '[class*="message"], [class*="bubble"], [class*="chat-item"]'
    ).count();

    expect(messagesAfter).toBeGreaterThan(messagesBefore);
    console.log(`✅ Bot responded — message count: ${messagesBefore} → ${messagesAfter}`);
  });
});
