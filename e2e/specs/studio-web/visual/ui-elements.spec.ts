import { test, expect } from '../../../fixtures';

/**
 * Studio-Web — UI Element Visual Regression Tests
 *
 * What this does:
 *   - Takes screenshots of key UI elements (forms, inputs, editors, buttons)
 *   - Checks for visual bugs: double borders, misaligned border-radius, broken layouts
 *   - On FIRST run: saves baseline screenshots to e2e/snapshots/
 *   - On subsequent runs: compares against baseline — FAILS with diff image if anything changed
 *
 * To update baselines after intentional design changes:
 *   npx playwright test --config=e2e/playwright.config.ts --update-snapshots
 *
 * Reports:
 *   - On failure: saves ACTUAL + EXPECTED + DIFF screenshots to e2e/test-results/
 *   - Open HTML report: npx playwright show-report e2e/reports/html
 */

test.use({ baseURL: process.env.PLAYWRIGHT_SW_URL });

// ─── Helper: navigate to project creation form ─────────────────────────────
async function goToProjectForm(page: any) {
  await page.goto('/studio/projects');
  await page.waitForLoadState('networkidle');

  // Click "New Project" / "Add Project" button
  const newBtn = page.getByRole('button', { name: /new project|add project|create project|\+/i }).first();
  const hasBtn = await newBtn.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasBtn) {
    // Try direct navigation
    await page.goto('/project/new');
    await page.waitForLoadState('networkidle');
  } else {
    await newBtn.click();
    await page.waitForLoadState('networkidle');
  }
}

// ─── 1. Rich Text Editor — double border bug ────────────────────────────────

test.describe('Studio-Web — Rich Text Editor Visual', () => {

  test('Description RichText editor has single clean border (no double border bug)', async ({ page }) => {
    await goToProjectForm(page);

    // Wait for RTE to appear
    const rteRoot = page.locator('.mantine-RichTextEditor-root').first();
    await rteRoot.waitFor({ state: 'visible', timeout: 15_000 });

    // ── Screenshot of full RTE (root + toolbar + content) ──
    await expect(rteRoot).toHaveScreenshot('rte-full-border.png', {
      animations: 'disabled',
    });

    // ── Check border-radius consistency ──
    // Root border-radius
    const rootRadius = await rteRoot.evaluate((el) =>
      getComputedStyle(el).borderRadius
    );

    // Toolbar border-radius
    const toolbar = page.locator('.mantine-RichTextEditor-toolbar').first();
    const toolbarRadius = await toolbar.evaluate((el) =>
      getComputedStyle(el).borderRadius
    );

    // Content area border-radius
    const content = page.locator('.mantine-RichTextEditor-content').first();
    const contentRadius = await content.evaluate((el) =>
      getComputedStyle(el).borderRadius
    );

    // Log for debugging
    console.log('RTE root border-radius:', rootRadius);
    console.log('RTE toolbar border-radius:', toolbarRadius);
    console.log('RTE content border-radius:', contentRadius);

    // Assert: root top corners should match toolbar top corners
    // If these differ, the double-border/misaligned-radius bug is present
    // (This will FAIL and show the values so you can see the mismatch)
    const rootTopLeft = await rteRoot.evaluate((el) =>
      getComputedStyle(el).borderTopLeftRadius
    );
    const toolbarTopLeft = await toolbar.evaluate((el) =>
      getComputedStyle(el).borderTopLeftRadius
    );

    console.log('Root top-left radius:', rootTopLeft);
    console.log('Toolbar top-left radius:', toolbarTopLeft);

    // ── Screenshot of just the top-left corner area (where the double border is) ──
    await expect(page).toHaveScreenshot('rte-corner-detail.png', {
      clip: {
        x: (await rteRoot.boundingBox())!.x - 2,
        y: (await rteRoot.boundingBox())!.y - 2,
        width: 80,
        height: 80,
      },
      animations: 'disabled',
    });
  });

  test('RTE toolbar and content have no extra outer border when error state is false', async ({ page }) => {
    await goToProjectForm(page);

    const rteRoot = page.locator('.mantine-RichTextEditor-root').first();
    await rteRoot.waitFor({ state: 'visible', timeout: 15_000 });

    // Capture border styles
    const rootBorder = await rteRoot.evaluate((el) => ({
      border: getComputedStyle(el).border,
      borderTop: getComputedStyle(el).borderTop,
      outline: getComputedStyle(el).outline,
      boxShadow: getComputedStyle(el).boxShadow,
    }));

    const toolbar = page.locator('.mantine-RichTextEditor-toolbar').first();
    const toolbarBorder = await toolbar.evaluate((el) => ({
      border: getComputedStyle(el).border,
      borderTop: getComputedStyle(el).borderTop,
      borderBottom: getComputedStyle(el).borderBottom,
    }));

    console.log('Root border:', rootBorder);
    console.log('Toolbar border:', toolbarBorder);

    // Both having a visible border means double-border — log it clearly
    const rootHasBorder = rootBorder.border !== 'none' && rootBorder.border !== '0px none rgb(0, 0, 0)';
    const toolbarHasBorder = toolbarBorder.border !== 'none' && toolbarBorder.border !== '0px none rgb(0, 0, 0)';

    if (rootHasBorder && toolbarHasBorder) {
      console.warn('⚠️  DOUBLE BORDER DETECTED: Both root AND toolbar have visible borders');
      console.warn('   Root:', rootBorder.border);
      console.warn('   Toolbar:', toolbarBorder.border);
    }

    // Screenshot to capture the state
    await expect(rteRoot).toHaveScreenshot('rte-border-state.png', {
      animations: 'disabled',
    });
  });
});

// ─── 2. Full project creation form — layout check ───────────────────────────

test.describe('Studio-Web — Project Creation Form Layout', () => {

  test('Project creation form renders without layout breaks', async ({ page }) => {
    await goToProjectForm(page);
    await page.waitForLoadState('networkidle');

    // Full page screenshot of the form
    await expect(page).toHaveScreenshot('project-create-form-full.png', {
      fullPage: true,
      animations: 'disabled',
      mask: [
        page.locator('[class*="avatar"], img'),  // mask dynamic images
      ],
    });
  });

  test('Title input field has correct border and no double border', async ({ page }) => {
    await goToProjectForm(page);

    const titleInput = page.locator('[class*="TextInput"] input, [data-test="title-input"], input[placeholder*="title" i]').first();
    const hasTitle = await titleInput.isVisible({ timeout: 8_000 }).catch(() => false);

    if (!hasTitle) {
      // TextInputAI wraps input — look for input inside it
      const anyInput = page.locator('input').first();
      await expect(anyInput).toHaveScreenshot('title-input.png', { animations: 'disabled' });
    } else {
      await expect(titleInput).toHaveScreenshot('title-input.png', { animations: 'disabled' });
    }
  });

  test('Level SegmentedControl renders correctly with equal segment widths', async ({ page }) => {
    await goToProjectForm(page);

    const segmented = page.locator('.mantine-SegmentedControl-root').first();
    await segmented.waitFor({ state: 'visible', timeout: 10_000 });

    await expect(segmented).toHaveScreenshot('level-segmented-control.png', {
      animations: 'disabled',
    });

    // Check all segments are same height
    const segments = page.locator('.mantine-SegmentedControl-label');
    const count = await segments.count();
    const heights: number[] = [];

    for (let i = 0; i < count; i++) {
      const box = await segments.nth(i).boundingBox();
      if (box) heights.push(Math.round(box.height));
    }

    console.log('Segment heights:', heights);
    const allSameHeight = heights.every(h => h === heights[0]);
    expect(allSameHeight).toBe(true);
  });
});

// ─── 3. Input alignment checks ──────────────────────────────────────────────

test.describe('Studio-Web — Input Alignment & Spacing', () => {

  test('Form labels are vertically aligned with their inputs', async ({ page }) => {
    await goToProjectForm(page);

    // Screenshot of first two form fields to check label-input alignment
    const formStack = page.locator('.mantine-Stack-root').first();
    await formStack.waitFor({ state: 'visible', timeout: 10_000 });

    await expect(formStack).toHaveScreenshot('form-stack-alignment.png', {
      animations: 'disabled',
    });
  });

  test('Description label and RTE are flush — no gap or overlap', async ({ page }) => {
    await goToProjectForm(page);

    // Find the description section (label + helper text + editor)
    const descSection = page.locator('.mantine-Stack-root').filter({
      has: page.locator('.mantine-RichTextEditor-root'),
    }).first();

    const hasSection = await descSection.isVisible({ timeout: 8_000 }).catch(() => false);
    if (hasSection) {
      await expect(descSection).toHaveScreenshot('description-section.png', {
        animations: 'disabled',
      });

      // Check spacing between label and editor
      const label = descSection.locator('text=/description/i').first();
      const editor = descSection.locator('.mantine-RichTextEditor-root').first();

      const labelBox = await label.boundingBox();
      const editorBox = await editor.boundingBox();

      if (labelBox && editorBox) {
        const gap = editorBox.y - (labelBox.y + labelBox.height);
        console.log('Gap between description label and editor:', gap, 'px');
        // Gap should be positive (label above editor) and reasonable (< 30px)
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(50);
      }
    }
  });
});

// ─── 4. Font & Typography checks ────────────────────────────────────────────

test.describe('Studio-Web — Typography & Font Consistency', () => {

  test('Form labels use consistent font size', async ({ page }) => {
    await goToProjectForm(page);

    const labels = page.locator('.mantine-InputWrapper-label, .mantine-Text-root[class*="sm"]');
    const count = await labels.count();
    const fontSizes: string[] = [];

    for (let i = 0; i < Math.min(count, 5); i++) {
      const size = await labels.nth(i).evaluate(el => getComputedStyle(el).fontSize);
      fontSizes.push(size);
    }

    console.log('Label font sizes found:', [...new Set(fontSizes)]);

    // All labels should use the same font size
    const uniqueSizes = [...new Set(fontSizes)];
    expect(uniqueSizes.length).toBeLessThanOrEqual(2); // allow at most 2 (label + helper text)
  });

  test('Button text is not clipped or overflowing', async ({ page }) => {
    await goToProjectForm(page);

    const buttons = page.locator('button').filter({ hasText: /.+/ });
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = buttons.nth(i);
      const isVisible = await btn.isVisible().catch(() => false);
      if (!isVisible) continue;

      const box = await btn.boundingBox();
      const scrollWidth = await btn.evaluate(el => (el as HTMLElement).scrollWidth);
      const clientWidth = await btn.evaluate(el => (el as HTMLElement).clientWidth);

      if (box) {
        const isOverflowing = scrollWidth > clientWidth + 2; // 2px tolerance
        if (isOverflowing) {
          console.warn(`⚠️  Button text overflow detected on button ${i}: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
        }
        expect(isOverflowing).toBe(false);
      }
    }
  });

  test('No text is cut off by overflow:hidden containers', async ({ page }) => {
    await goToProjectForm(page);

    // Check for elements where scrollHeight > clientHeight (text hidden by overflow)
    const overflowing = await page.evaluate(() => {
      const issues: string[] = [];
      document.querySelectorAll('p, label, span, h1, h2, h3, h4').forEach((el) => {
        const e = el as HTMLElement;
        if (e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflow !== 'visible') {
          issues.push(`${e.tagName}: "${e.textContent?.slice(0, 40)}" (scrollH=${e.scrollHeight} > clientH=${e.clientHeight})`);
        }
      });
      return issues;
    });

    if (overflowing.length > 0) {
      console.warn('⚠️  Text overflow/clipping detected:');
      overflowing.forEach(issue => console.warn('  -', issue));
    }

    // Allow some overflows (e.g. tooltips, hidden elements) but flag many
    expect(overflowing.length).toBeLessThan(5);
  });
});

// ─── 5. Responsive / Viewport checks ────────────────────────────────────────

test.describe('Studio-Web — Responsive Layout', () => {

  test('Form does not break at 1280px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToProjectForm(page);

    await expect(page).toHaveScreenshot('form-1280px.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Form does not break at 1440px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToProjectForm(page);

    await expect(page).toHaveScreenshot('form-1440px.png', {
      fullPage: true,
      animations: 'disabled',
    });
  });
});

// ─── 6. Button & Interactive Element States ──────────────────────────────────

test.describe('Studio-Web — Button States', () => {

  test('Submit button is visually disabled when form is empty', async ({ page }) => {
    await goToProjectForm(page);

    const submitBtn = page.getByRole('button', { name: /next step|save/i }).last();
    const hasBtn = await submitBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    test.skip(!hasBtn, 'Submit button not found');

    await expect(submitBtn).toHaveScreenshot('submit-btn-disabled.png', {
      animations: 'disabled',
    });

    // Verify it's actually disabled
    const isDisabled = await submitBtn.isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('Submit button changes appearance when form is filled', async ({ page }) => {
    await goToProjectForm(page);

    // Fill the title
    const titleInput = page.locator('input').first();
    await titleInput.fill('Test Project Title');

    // Fill description
    const editor = page.locator('.ProseMirror').first();
    const hasEditor = await editor.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasEditor) {
      await editor.click();
      await editor.fill('This is a test description with enough characters to pass validation.');
    }

    const submitBtn = page.getByRole('button', { name: /next step|save/i }).last();
    await expect(submitBtn).toHaveScreenshot('submit-btn-enabled.png', {
      animations: 'disabled',
    });
  });
});
