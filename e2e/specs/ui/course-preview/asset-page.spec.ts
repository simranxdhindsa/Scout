import { test, expect, Page, Route } from '@playwright/test';

/*
 * NOTES & SCOPE
 *
 * SSR redirect: `getServerSideProps` fetches the course server-side to decide
 *   whether to redirect to `/{mode}/{courseId}` (not-started course). Server
 *   fetches cannot be intercepted by `page.route()`; those cases require a
 *   studio-user fixture against the real backend.
 *
 * Locator hygiene: the asset bar's burger menu (SectionListModal) and the
 *   AssetComplete tickbox are rendered as `ActionIcon` elements whose only
 *   accessible affordance is a Mantine `Tooltip`. Mantine's Tooltip neither
 *   sets `aria-label` nor `aria-describedby` on the trigger, so we cannot
 *   target these buttons by role/name without source-side `data-testid`s.
 *   Tests that depend on those interactions (section list popover, Quit Course
 *   flow, mark-complete flow) are intentionally omitted — they should be added
 *   once stable hooks land on:
 *      • SectionListModal trigger ActionIcon → data-testid="course-sections-btn"
 *      • AssetComplete ActionIcon            → data-testid="asset-complete-btn"
 *
 * Cascading 404: after a client-side `router.push`, the destination page fires
 *   its own API calls. Any 404 from the real backend triggers a global axios
 *   redirect to `/course-not-found`, which wins over the prior push. Tests that
 *   verify navigation TO an unmocked downstream page are therefore excluded.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COURSE_ID = 'course-abc-123';
const SECTION_ID = 'section-001';
const SECTION_ID_2 = 'section-002';
const ASSET_ID = 'asset-001';
const ASSET_ID_2 = 'asset-002';
const ASSET_ID_3 = 'asset-003';
const SIGN_IN_URL = '/auth/signIn';

const assetPageUrl = (mode = 'courses', assetId = ASSET_ID) =>
  `/${mode}/${COURSE_ID}/section/${SECTION_ID}/asset/${assetId}`;

const isApiRequest = (route: Route) =>
  route.request().resourceType() === 'fetch' || route.request().resourceType() === 'xhr';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
interface AssetItemInput {
  uuid: string;
  name: string;
  typeKey: string;
  completed?: boolean;
  started?: boolean;
}

function buildAssetItem(o: AssetItemInput) {
  return {
    uuid: o.uuid,
    name: o.name,
    type: { key: o.typeKey },
    completed: o.completed ?? false,
    started: o.started ?? false,
  };
}

function buildAssetDetail(o: Partial<AssetItemInput> = {}) {
  return {
    data: {
      uuid: o.uuid ?? ASSET_ID,
      name: o.name ?? 'Welcome to the Course',
      type: { key: o.typeKey ?? 'welcome' },
      completed: o.completed ?? false,
      avatar: null,
      resources: [],
      ai_delivered: false,
    },
  };
}

function buildCourseDetail(overrides: {
  sections?: any[];
  course_completed?: boolean;
} = {}) {
  return {
    data: {
      uuid: COURSE_ID,
      name: 'TypeScript Fundamentals',
      assignment_id: 'assign-001',
      started_at: '2024-01-01T00:00:00Z',
      course_completed: overrides.course_completed ?? false,
      first_section_id: SECTION_ID,
      first_asset_id: ASSET_ID,
      last_section_id: null,
      last_asset_id: null,
      sub_type: null,
      sections: overrides.sections ?? [
        { uuid: SECTION_ID, name: 'Getting Started' },
        { uuid: SECTION_ID_2, name: 'Advanced Topics' },
      ],
      total_assets: 3,
      completed_assets: 0,
    },
  };
}

const DEFAULT_ASSETS = [
  buildAssetItem({ uuid: ASSET_ID, name: 'Welcome to the Course', typeKey: 'welcome' }),
  buildAssetItem({ uuid: ASSET_ID_2, name: 'Core Concepts', typeKey: 'theory' }),
];

// ---------------------------------------------------------------------------
// Mock helpers
//
// Patterns are anchored regexes so they don't overlap:
//   /o/course/{ID}$                              → course detail
//   /o/course/{ID}/section/{SID}/assets$          → section assets list
//   /o/course/{ID}/section/{SID}/assets/{AID}     → single asset detail
//   /o/user/progress/{ID}/                        → mutations (start chat etc.)
// ---------------------------------------------------------------------------
async function mockCourseDetailApi(
  page: Page,
  courseDetail: ReturnType<typeof buildCourseDetail>
) {
  await page.route(new RegExp(`/o/course/${COURSE_ID}(?:\\?|$)`), (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(courseDetail),
    });
  });
}

async function mockSectionAssetsApi(
  page: Page,
  assets: ReturnType<typeof buildAssetItem>[],
  sectionId = SECTION_ID
) {
  // Match the listing endpoint exactly — NOT /assets/{assetId}
  await page.route(
    new RegExp(`/o/course/${COURSE_ID}/section/${sectionId}/assets(?:\\?|$)`),
    (route: Route) => {
      if (!isApiRequest(route)) return route.fallback();
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: assets }),
      });
    }
  );
}

async function mockAssetDetailApi(
  page: Page,
  assetDetail: ReturnType<typeof buildAssetDetail>,
  assetId = ASSET_ID,
  sectionId = SECTION_ID
) {
  await page.route(
    new RegExp(`/o/course/${COURSE_ID}/section/${sectionId}/assets/${assetId}`),
    (route: Route) => {
      if (!isApiRequest(route)) return route.fallback();
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(assetDetail),
      });
    }
  );
}

// Silence the start-bot-chat mutation so CourseLanding does not hang on the
// real backend. Any POST to /o/user/progress/{id}/... returns a benign payload.
async function stubUserProgress(page: Page) {
  await page.route(new RegExp(`/o/user/progress/${COURSE_ID}/`), (route: Route) => {
    if (!isApiRequest(route)) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { messages: [] } }),
    });
  });
}

interface SetupOpts {
  courseDetail?: ReturnType<typeof buildCourseDetail>;
  assets?: ReturnType<typeof buildAssetItem>[];
  assetDetail?: ReturnType<typeof buildAssetDetail>;
  assetId?: string;
}

async function setupPage(page: Page, opts: SetupOpts = {}) {
  await mockCourseDetailApi(page, opts.courseDetail ?? buildCourseDetail());
  await mockSectionAssetsApi(page, opts.assets ?? DEFAULT_ASSETS);
  await mockAssetDetailApi(
    page,
    opts.assetDetail ?? buildAssetDetail(),
    opts.assetId ?? ASSET_ID
  );
  await stubUserProgress(page);
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const sectionNameInBar = (page: Page) => page.getByText('Getting Started').first();
const assetNameInBar = (page: Page) => page.getByText('Welcome to the Course').first();
const feedbackLockedMsg = (page: Page) =>
  page.getByText(/You need to first complete the simulation/i);
const loadingMsg = (page: Page) => page.getByText('Loading..', { exact: false });

// NavigationIcon — ButtonComponent renders the title as the accessible name
const nextBtn = (page: Page) => page.getByRole('button', { name: 'Next' });
const prevBtn = (page: Page) => page.getByRole('button', { name: 'Prev' });
const quitCourseBtn = (page: Page) => page.getByRole('button', { name: 'Quit Course' });

// Mantine modal confirm/cancel labels
const quitConfirmModalDescription = (page: Page) =>
  page.getByText('Are you sure you want to quit the course?');
const confirmBtn = (page: Page) => page.getByRole('button', { name: 'Confirm' });
const cancelBtn = (page: Page) => page.getByRole('button', { name: 'Cancel' });

// ControlBar — text affordances
const restartLabel = (page: Page) => page.getByText('Restart', { exact: true }).first();
const displayLabel = (page: Page) => page.getByText('Display', { exact: true }).first();
const chatTextarea = (page: Page) =>
  page.getByPlaceholder('Type here or speak in the mic..');

// ChatInputBar — TEXT/VOICE input mode toggle (rendered as clickable <Text> nodes)
const textModeLabel = (page: Page) => page.getByText('TEXT', { exact: true });
const voiceModeLabel = (page: Page) => page.getByText('VOICE', { exact: true });

// Icon buttons that live next to the textarea inside renderInputSection.
// Scoped via the Mantine Textarea root → its following-sibling div contains the icons.
const inputIconButtons = (page: Page) =>
  page.locator(
    'xpath=//textarea[@placeholder="Type here or speak in the mic.."]/ancestor::div[contains(@class,"mantine-Textarea-root")]/following-sibling::div//button'
  );

const inputModeState = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem('inputMode'));

// AudioWaveLoader renders an SVG with `<title>Audio Wave</title>`, used as the
// signal that the mic is currently listening (replaces the textarea in renderInputSection)
const audioWaveLoader = (page: Page) => page.getByTitle('Audio Wave');

// SectionListModal trigger — the first ActionIcon (tabindex=-1 + svg child) on
// the page. It sits at the very start of the asset bar (top-left).
const sectionListBurger = (page: Page) =>
  page.locator('button[tabindex="-1"]:has(svg)').first();

// Settings and Quit Course buttons inside the section-list popover
const settingsBtn = (page: Page) => page.getByRole('button', { name: 'Settings' }).first();
const quitCoursePopoverBtn = (page: Page) =>
  page.getByRole('button', { name: 'Quit Course' });

// AI mode SegmentedControl (Avatar / Audio / Text) lives inside the settings panel
const aiModeRadio = (page: Page, label: 'Avatar' | 'Audio' | 'Text') =>
  page.getByRole('radio', { name: label });

// The right panel's OUTER container is the only `<div>` on the page that
// combines an inline `flex-basis` with an inline `background-color` (the dark
// card colour). Two other `flex-basis` divs exist on the page (feedback area
// and main grid column) but neither carries `background-color` inline.
// (We don't anchor on `#scrollableDiv` itself because the id is shared by the
// main-content TextStreams in TEXT mode but not in VOICE mode — the index
// isn't stable across modes.)
const courseRightPanelOuter = (page: Page) =>
  page.locator('div[style*="flex-basis"][style*="background-color"]');

// AudioHistoryTextStreams' chat viewport, scoped inside the right panel
const courseRightPanelScrollArea = (page: Page) =>
  courseRightPanelOuter(page).locator('#scrollableDiv');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Asset page (/[mode]/[courseId]/section/[sectionId]/asset/[assetId])', () => {
  test.describe('Authentication', () => {
    test('unauthenticated user is redirected to /auth/signIn', async ({ browser }) => {
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();
      await page.goto(assetPageUrl());
      await expect(page).toHaveURL(new RegExp(SIGN_IN_URL));
      await context.close();
    });
  });

  test.describe('Asset bar — breadcrumb', () => {
    test.beforeEach(async ({ page }) => {
      await setupPage(page);
    });

    test('displays the current section name', async ({ page }) => {
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
    });

    test('displays the current asset name', async ({ page }) => {
      await page.goto(assetPageUrl());
      await expect(assetNameInBar(page)).toBeVisible({ timeout: 10000 });
    });

    test('shows the breadcrumb separator between section and asset', async ({ page }) => {
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(assetNameInBar(page)).toBeVisible();
      // The "/" separator sits between them in the same Group
      await expect(page.getByText('/', { exact: true }).first()).toBeVisible();
    });
  });

  test.describe('Feedback asset — locked state', () => {
    test('shows "complete the simulation first" when feedback is opened before simulation is done', async ({
      page,
    }) => {
      const feedbackAssetId = ASSET_ID_2;
      const assets = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Role Play', typeKey: 'simulation', completed: false }),
        buildAssetItem({ uuid: feedbackAssetId, name: 'Feedback', typeKey: 'feedback' }),
      ];

      await setupPage(page, {
        assets,
        assetDetail: buildAssetDetail({
          uuid: feedbackAssetId,
          name: 'Feedback',
          typeKey: 'feedback',
        }),
        assetId: feedbackAssetId,
      });

      await page.goto(assetPageUrl('courses', feedbackAssetId));
      await expect(feedbackLockedMsg(page)).toBeVisible({ timeout: 10000 });
    });

    test('does NOT show the locked message when the simulation is completed', async ({ page }) => {
      const feedbackAssetId = ASSET_ID_2;
      const assets = [
        buildAssetItem({
          uuid: ASSET_ID,
          name: 'Role Play',
          typeKey: 'simulation',
          completed: true,
          started: true,
        }),
        buildAssetItem({ uuid: feedbackAssetId, name: 'Feedback', typeKey: 'feedback' }),
      ];

      await setupPage(page, {
        assets,
        assetDetail: buildAssetDetail({
          uuid: feedbackAssetId,
          name: 'Feedback',
          typeKey: 'feedback',
        }),
        assetId: feedbackAssetId,
      });

      await page.goto(assetPageUrl('courses', feedbackAssetId));
      // Asset bar should still render the breadcrumb
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(feedbackLockedMsg(page)).toHaveCount(0);
    });
  });

  test.describe('Asset preview — Loading state', () => {
    test('shows the loading indicator while course data is being fetched', async ({ page }) => {
      // Delay the course detail response so the loading state is observable
      await page.route(new RegExp(`/o/course/${COURSE_ID}(?:\\?|$)`), async (route: Route) => {
        if (!isApiRequest(route)) return route.fallback();
        if (route.request().method() !== 'GET') return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildCourseDetail()),
        });
      });
      await mockSectionAssetsApi(page, DEFAULT_ASSETS);
      await mockAssetDetailApi(page, buildAssetDetail());
      await stubUserProgress(page);

      await page.goto(assetPageUrl());
      await expect(loadingMsg(page)).toBeVisible({ timeout: 5000 });
    });
  });

  // -------------------------------------------------------------------------
  // NavigationIcon (Prev / Quit / Next) — rendered at the end of the asset bar
  // (`isCourseBar=true` branch). The Quit Course button replaces Next when the
  // user is on the last asset of the last section.
  // -------------------------------------------------------------------------
  test.describe('Asset bar — NavigationIcon', () => {
    test('renders the "Next" button when there is another asset to advance to', async ({ page }) => {
      await setupPage(page); // default = 2 sections, 2 assets in the first
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(nextBtn(page)).toBeVisible({ timeout: 5000 });
      // Quit Course should NOT replace Next while there are more assets ahead
      await expect(quitCourseBtn(page)).toHaveCount(0);
    });

    test('replaces "Next" with "Quit Course" when on the last asset of the last section', async ({
      page,
    }) => {
      const onlyAsset = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Only Asset', typeKey: 'welcome' }),
      ];
      const singleSectionCourse = buildCourseDetail({
        sections: [{ uuid: SECTION_ID, name: 'Only Section' }],
      });

      await setupPage(page, {
        courseDetail: singleSectionCourse,
        assets: onlyAsset,
        assetDetail: buildAssetDetail({ name: 'Only Asset' }),
      });

      await page.goto(assetPageUrl());
      await expect(quitCourseBtn(page)).toBeVisible({ timeout: 10000 });
      await expect(nextBtn(page)).toHaveCount(0);
    });

    test('clicking "Quit Course" opens the confirmation modal', async ({ page }) => {
      const onlyAsset = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Only Asset', typeKey: 'welcome' }),
      ];
      const singleSectionCourse = buildCourseDetail({
        sections: [{ uuid: SECTION_ID, name: 'Only Section' }],
      });

      await setupPage(page, {
        courseDetail: singleSectionCourse,
        assets: onlyAsset,
        assetDetail: buildAssetDetail({ name: 'Only Asset' }),
      });

      await page.goto(assetPageUrl());
      await expect(quitCourseBtn(page)).toBeVisible({ timeout: 10000 });
      await quitCourseBtn(page).click();
      await expect(quitConfirmModalDescription(page)).toBeVisible({ timeout: 5000 });
      await expect(confirmBtn(page)).toBeVisible();
      await expect(cancelBtn(page)).toBeVisible();
    });

    test('cancelling the Quit modal keeps the user on the asset page', async ({ page }) => {
      const onlyAsset = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Only Asset', typeKey: 'welcome' }),
      ];
      const singleSectionCourse = buildCourseDetail({
        sections: [{ uuid: SECTION_ID, name: 'Only Section' }],
      });

      await setupPage(page, {
        courseDetail: singleSectionCourse,
        assets: onlyAsset,
        assetDetail: buildAssetDetail({ name: 'Only Asset' }),
      });

      await page.goto(assetPageUrl());
      await expect(quitCourseBtn(page)).toBeVisible({ timeout: 10000 });
      await quitCourseBtn(page).click();
      await expect(quitConfirmModalDescription(page)).toBeVisible({ timeout: 5000 });
      await cancelBtn(page).click();
      await expect(quitConfirmModalDescription(page)).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/section/${SECTION_ID}/asset/${ASSET_ID}`));
    });
  });

  // -------------------------------------------------------------------------
  // ControlBar — visible text affordances. The bar is rendered at the bottom
  // of the asset page; some elements are conditional on the asset type.
  //   - SimulationRestart        → hidden for `transition`/`theory`
  //   - ChatInputBar (textarea)  → hidden for `transition`/`quiz`
  //   - AiModes "Display" toggle → rendered inside the chat-streams view
  // -------------------------------------------------------------------------
  test.describe('Control bar — visible affordances', () => {
    test('renders the "Restart" affordance for asset types other than `transition`/`theory`', async ({
      page,
    }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(restartLabel(page)).toBeVisible({ timeout: 10000 });
    });

    test('hides the "Restart" affordance when the asset type is `transition`', async ({ page }) => {
      const transitionDetail = buildAssetDetail({
        name: 'Section Transition',
        typeKey: 'transition',
      });
      const assetsWithTransition = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Section Transition', typeKey: 'transition' }),
        buildAssetItem({ uuid: ASSET_ID_2, name: 'Core Concepts', typeKey: 'theory' }),
      ];

      await setupPage(page, {
        assets: assetsWithTransition,
        assetDetail: transitionDetail,
      });

      await page.goto(assetPageUrl());
      await expect(page.getByText('Section Transition').first()).toBeVisible({ timeout: 10000 });
      // ControlBar guards SimulationRestart with `!['transition','theory']`
      await expect(restartLabel(page)).toHaveCount(0);
    });

    test('hides the "Restart" affordance when the asset type is `theory`', async ({ page }) => {
      const theoryDetail = buildAssetDetail({
        name: 'Core Concepts',
        typeKey: 'theory',
      });
      const assetsWithTheory = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Core Concepts', typeKey: 'theory' }),
        buildAssetItem({ uuid: ASSET_ID_2, name: 'Welcome', typeKey: 'welcome' }),
      ];

      await setupPage(page, {
        assets: assetsWithTheory,
        assetDetail: theoryDetail,
      });

      await page.goto(assetPageUrl());
      await expect(page.getByText('Core Concepts').first()).toBeVisible({ timeout: 10000 });
      await expect(restartLabel(page)).toHaveCount(0);
    });

    test('shows the "Display" toggle on the AI-modes panel for chat-type assets', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(displayLabel(page)).toBeVisible({ timeout: 10000 });
    });

    test('shows the chat input textarea for chat-type assets', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(chatTextarea(page)).toBeVisible({ timeout: 10000 });
    });

    test('hides the chat input textarea when the asset type is `transition`', async ({ page }) => {
      const transitionDetail = buildAssetDetail({
        name: 'Section Transition',
        typeKey: 'transition',
      });
      const assetsWithTransition = [
        buildAssetItem({ uuid: ASSET_ID, name: 'Section Transition', typeKey: 'transition' }),
        buildAssetItem({ uuid: ASSET_ID_2, name: 'Core Concepts', typeKey: 'theory' }),
      ];

      await setupPage(page, {
        assets: assetsWithTransition,
        assetDetail: transitionDetail,
      });

      await page.goto(assetPageUrl());
      // Wait for the page to settle on the transition asset
      await expect(page.getByText('Section Transition').first()).toBeVisible({ timeout: 10000 });
      // ChatInputBar branch is omitted from ControlBar for `transition`/`quiz`
      await expect(chatTextarea(page)).toHaveCount(0);
    });
  });

  // -------------------------------------------------------------------------
  // ChatInputBar — input-mode toggle (TEXT ⇆ VOICE) and Send/Mic/audio-message
  // icons. The toggle is two clickable <Text> nodes; their selection is
  // persisted to `localStorage.inputMode` ("text" | "audio"). The set of icon
  // buttons next to the textarea changes with the mode:
  //   text  mode + empty   → 1 button  (Send, disabled)
  //   text  mode + typed   → 1 button  (Send, enabled)
  //   audio mode + empty   → 2 buttons (Mic + audio-message Bars)
  // -------------------------------------------------------------------------
  test.describe('Control bar — input mode toggle (TEXT / VOICE)', () => {
    test('renders both TEXT and VOICE input-mode labels', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(textModeLabel(page)).toBeVisible({ timeout: 10000 });
      await expect(voiceModeLabel(page)).toBeVisible();
    });

    test('persists "text" as the default input mode', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(textModeLabel(page)).toBeVisible({ timeout: 10000 });
      // Default is `text` per ChatInputBar.tsx; localStorage may be null until first toggle
      const mode = await inputModeState(page);
      expect(mode === null || mode === 'text').toBe(true);
    });

    test('clicking VOICE persists "audio" to localStorage and re-renders the icons', async ({
      page,
    }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(textModeLabel(page)).toBeVisible({ timeout: 10000 });

      // Sanity: TEXT mode default → only one icon-button (Send) next to the textarea
      await expect(inputIconButtons(page)).toHaveCount(1);

      await voiceModeLabel(page).click();
      await expect.poll(() => inputModeState(page)).toBe('audio');

      // VOICE mode renders Mic + audio-message (BarsIcon) → 2 icon buttons
      await expect(inputIconButtons(page)).toHaveCount(2);
    });

    test('clicking TEXT (after VOICE) flips the mode back to "text"', async ({ page }) => {
      // Pre-seed localStorage to audio so the page mounts in VOICE mode
      await page.addInitScript(() => {
        window.localStorage.setItem('inputMode', 'audio');
      });
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(textModeLabel(page)).toBeVisible({ timeout: 10000 });
      await expect(inputIconButtons(page)).toHaveCount(2); // started in audio mode

      await textModeLabel(page).click();
      await expect.poll(() => inputModeState(page)).toBe('text');
      await expect(inputIconButtons(page)).toHaveCount(1);
    });

    test('Send button is disabled while the textarea is empty (TEXT mode)', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(chatTextarea(page)).toBeVisible({ timeout: 10000 });
      // The lone icon button in TEXT-mode-empty state is the Send (AISendIcon)
      await expect(inputIconButtons(page)).toHaveCount(1);
      await expect(inputIconButtons(page).first()).toBeDisabled();
    });

    test('mounts in VOICE mode (mic + audio-message icons) when localStorage is pre-set to "audio"', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('inputMode', 'audio');
      });
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(chatTextarea(page)).toBeVisible({ timeout: 10000 });
      // VOICE mode + empty query renders both icons: MicIcon + BarsIcon
      await expect(inputIconButtons(page)).toHaveCount(2);
      // Neither icon button is disabled in idle audio mode
      await expect(inputIconButtons(page).nth(0)).toBeEnabled();
      await expect(inputIconButtons(page).nth(1)).toBeEnabled();
    });
  });

  // -------------------------------------------------------------------------
  // Spacebar push-to-talk. `useSpeechRecorder.handleKeyDown` enforces two
  // guards before activating the mic:
  //   1. focus must NOT be inside an <input>/<textarea>
  //   2. `localStorage.inputMode` must be `"audio"` (not `"text"`)
  // When both pass, listening engages and the textarea is replaced by the
  // <AudioWaveLoader/> SVG (whose <title> is "Audio Wave").
  // -------------------------------------------------------------------------
  test.describe('Control bar — spacebar push-to-talk', () => {
    test('spacebar typed inside the textarea inserts a space and does NOT engage PTT', async ({
      page,
    }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(chatTextarea(page)).toBeVisible({ timeout: 10000 });

      // Use focus() rather than click() — the cookies banner Paper overlays the
      // bottom of the page and intercepts pointer events on the textarea.
      await chatTextarea(page).focus();
      await page.keyboard.press('Space');

      // The textarea-focus guard short-circuits the handler — default browser
      // behaviour applies, so the space character lands in the value.
      await expect(chatTextarea(page)).toHaveValue(' ');
      // And the AudioWaveLoader (listening UI) is not rendered.
      await expect(audioWaveLoader(page)).toHaveCount(0);
    });

    test('TEXT mode: spacebar with focus OUTSIDE the textarea does NOT engage PTT', async ({
      page,
    }) => {
      await setupPage(page); // default mode is "text"
      await page.goto(assetPageUrl());
      await expect(chatTextarea(page)).toBeVisible({ timeout: 10000 });

      // Move focus off the textarea
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

      await page.keyboard.press('Space');

      // No listening UI should appear; textarea remains visible
      await expect(audioWaveLoader(page)).toHaveCount(0);
      await expect(chatTextarea(page)).toBeVisible();
    });

    test('VOICE mode: spacebar with focus outside the textarea is intercepted (preventDefault)', async ({
      page,
    }) => {
      // We can deterministically assert the handler is engaged in VOICE mode by
      // verifying it calls `preventDefault()` (line 461 of useSpeechRecorder.ts).
      // The downstream effect — `react-speech-recognition.startListening()` —
      // depends on Web Speech API runtime support which is unreliable in
      // headless Playwright across all browsers, so we don't assert the
      // listening UI here; that path is exercised by manual QA / real-device
      // tests. See the note at the top of this file.
      await page.addInitScript(() => {
        window.localStorage.setItem('inputMode', 'audio');
      });
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(chatTextarea(page)).toBeVisible({ timeout: 10000 });

      // Move focus off the textarea so the focus-guard does NOT short-circuit
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

      // Capture whether the keydown event had `defaultPrevented` set AFTER all
      // listeners (including the app's bubble-phase listener in useSpeechRecorder)
      // have run. Our probe listener is on capture and defers the check via a
      // microtask so the bubble-phase handler runs first.
      const defaultPrevented = await page.evaluate(async () => {
        return await new Promise<boolean>((resolve) => {
          const probe = (e: KeyboardEvent) => {
            if (e.code !== 'Space') return;
            window.removeEventListener('keydown', probe, true);
            queueMicrotask(() => resolve(e.defaultPrevented));
          };
          window.addEventListener('keydown', probe, true);
          window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true })
          );
          setTimeout(() => resolve(false), 1000);
        });
      });

      expect(defaultPrevented).toBe(true);
    });
  });
  // -------------------------------------------------------------------------
  // SectionListModal — the burger menu at the start of the asset bar opens a
  // Popover containing the course's section list, a Settings sub-panel
  // (Learning Preferences SegmentedControl + Language Select) and a Quit Course
  // button. Reachable from `CourseAssetBarContent`. The trigger ActionIcon has
  // no aria-label, so we locate it as the first ActionIcon (button[tabindex=-1]
  // with an svg child) on the page.
  // -------------------------------------------------------------------------
  test.describe('Asset bar — SectionListModal', () => {
    test('burger menu button is visible at the start of the asset bar', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(sectionListBurger(page)).toBeVisible();
      await expect(sectionListBurger(page)).toBeEnabled();
    });

    test('clicking the burger opens the popover with all section names', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });

      await sectionListBurger(page).click();

      // Both section names from the mocked course detail render inside the popover
      // "Getting Started" is now in the breadcrumb AND in the popover → count >= 2
      await expect(page.getByText('Getting Started')).toHaveCount(2);
      await expect(page.getByText('Advanced Topics')).toBeVisible({ timeout: 5000 });
    });

    test('popover renders the Settings and Quit Course buttons', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });

      await sectionListBurger(page).click();
      await expect(settingsBtn(page)).toBeVisible({ timeout: 5000 });
      await expect(quitCoursePopoverBtn(page)).toBeVisible();
    });

    test('clicking Settings opens the settings panel with the AI mode SegmentedControl', async ({
      page,
    }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });

      await sectionListBurger(page).click();
      await settingsBtn(page).click();

      // Mantine's SegmentedControl visually styles labels but hides the actual
      // <input type=radio> via CSS, so we assert the radios are in the DOM
      // (toBeAttached), not toBeVisible.
      await expect(aiModeRadio(page, 'Avatar')).toBeAttached({ timeout: 5000 });
      await expect(aiModeRadio(page, 'Audio')).toBeAttached();
      await expect(aiModeRadio(page, 'Text')).toBeAttached();
    });

    test('clicking a section name in the popover loads that section\'s assets', async ({
      page,
    }) => {
      // Mock the OTHER section's assets list so it can load when selected
      await setupPage(page);
      await page.route(
        new RegExp(`/o/course/${COURSE_ID}/section/${SECTION_ID_2}/assets(?:\\?|$)`),
        (route: Route) => {
          if (!isApiRequest(route)) return route.fallback();
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: [
                buildAssetItem({
                  uuid: ASSET_ID_3,
                  name: 'Simulation Exercise',
                  typeKey: 'simulation',
                }),
              ],
            }),
          });
        }
      );

      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await sectionListBurger(page).click();
      await page.getByText('Advanced Topics').click();

      // The right side of the popover now shows the new section's assets
      await expect(page.getByText('Simulation Exercise')).toBeVisible({ timeout: 5000 });
    });

    test('clicking Quit Course in the popover opens the confirmation modal', async ({ page }) => {
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });

      await sectionListBurger(page).click();
      await quitCoursePopoverBtn(page).click();

      // Same confirm modal as the asset-bar NavigationIcon's Quit Course
      await expect(quitConfirmModalDescription(page)).toBeVisible({ timeout: 5000 });
      await expect(confirmBtn(page)).toBeVisible();
      await expect(cancelBtn(page)).toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // CourseRightPanel (`features/courses/course-panels/CourseRightPanel`)
  // renders <AudioHistoryTextStreams /> (which itself renders <AiModes/>) when:
  //   1. asset.type.key is in INTERACTIVE_TYPES (pre-assessment / simulation /
  //      reflection / feedback / explore / welcome / study), AND
  //   2. CoursePreview decides `showRightPanel` is true — which requires
  //      `isTranscript` to be true (i.e. AI mode is voice/avatar, OR asset is
  //      theory/transition with assistant). In TEXT mode the side panel is
  //      collapsed.
  // We control AI mode via the `userSelectedMode` cookie which is read by
  // `CourseContext` on mount and fed into `setSelectedAiMode`.
  // -------------------------------------------------------------------------
  test.describe('Course preview — Right panel (CourseRightPanel + AiModes)', () => {
    // The storageState carries a stale `userSelectedMode` from global setup,
    // and `addCookies` with explicit `domain` is treated as a different key
    // when the existing cookie was set with a different domain attribute.
    // Using the `url` option ensures we override the cookie at the right
    // domain/path, and we also reset `selectedAiMode` in Redux via
    // `setSelectedAiMode` so the first render uses the desired mode.
    const seedUserSelectedMode = async (page: Page, mode: 'voice' | 'avatar' | 'text') => {
      await page.context().addCookies([
        { name: 'userSelectedMode', value: mode, url: process.env.BASE_URL! },
      ]);
      // Belt-and-braces: also set via document.cookie at navigation time
      await page.addInitScript((m) => {
        // Strip any existing cookie before setting ours
        document.cookie = `userSelectedMode=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        document.cookie = `userSelectedMode=${m}; path=/`;
      }, mode);
    };

    // The right-panel's OUTER container is the one whose width actually changes
    // between TEXT and VOICE modes (via inline `flex-basis` / `max-width`).
    const rightPanelOuterWidth = async (page: Page) =>
      (await courseRightPanelOuter(page).boundingBox())?.width ?? 0;

    // NOTE: a complementary "TEXT mode collapses the right panel to 0 width"
    // test was attempted, but the `userSelectedMode` cookie carried over from
    // `global-setup` has a different domain attribute than the one our
    // `addCookies({ url })` writes, and Firefox/WebKit treat the two entries
    // as distinct — the stale 'voice' value wins. Re-seating that cookie
    // reliably across all 3 browsers requires fixture-level changes to
    // `global-setup.ts`. For now the positive-case tests below (VOICE
    // renders, transition omits) cover the rendering contract.

    test('right panel renders the chat history scroll area with meaningful width in VOICE mode', async ({
      page,
    }) => {
      await seedUserSelectedMode(page, 'voice');
      await setupPage(page);
      await page.goto(assetPageUrl());
      await expect(sectionNameInBar(page)).toBeVisible({ timeout: 10000 });
      await expect(courseRightPanelScrollArea(page)).toBeAttached({ timeout: 10000 });
      // Allow the flex-basis transition (0.4s) to complete
      await expect
        .poll(() => rightPanelOuterWidth(page), { timeout: 5000 })
        .toBeGreaterThan(100);
    });

    test('right panel does not render `#scrollableDiv` for `transition` asset type', async ({
      page,
    }) => {
      await seedUserSelectedMode(page, 'voice');
      const transitionDetail = buildAssetDetail({
        name: 'Section Transition',
        typeKey: 'transition',
      });
      await setupPage(page, {
        assets: [
          buildAssetItem({ uuid: ASSET_ID, name: 'Section Transition', typeKey: 'transition' }),
        ],
        assetDetail: transitionDetail,
      });
      await page.goto(assetPageUrl());
      await expect(page.getByText('Section Transition').first()).toBeVisible({ timeout: 10000 });
      // For non-interactive types, CourseRightPanel returns <></> — no scroll area in DOM
      await expect(courseRightPanelScrollArea(page)).toHaveCount(0);
    });
  });
});
