import { test, expect, Page, Route } from '@playwright/test';

/*
 * ASSUMPTIONS
 * 1. Auth: playwright.config.ts storageState (globalSetup) covers all tests.
 * 2. API endpoint patterns:
 *      useGetUserPreference    GET  …/onboarding/user-preferences…
 *      onboarding-complete     POST …/onboarding/complete…
 * 3. Real UserPreference shape (data field) — verified from network:
 *      learning_preference?:  'avatar' | 'voice' | 'text'
 *      avatar:                { uuid, name, avatar_display?, ... }
 *      audio_model?:          { uuid, audio_model: { name, description, category } }
 *      current_focus?:        string  (free text, shown as-is)
 *      career_growth?:        string  (free text, shown as-is)
 *      interests:             Array<{ uuid, key, translations: [{ uuid, language, value }] }>
 *      NOTE: communication_preference is not returned by this endpoint; the card
 *            may be sourced elsewhere or always rendered by the component.
 * 4. learning_preference maps to tour route:
 *      'avatar' → /onboarding/tour/avatar
 *      'voice'  → /onboarding/tour/audio
 *      'text'   → /onboarding/tour/text   (also the fallback)
 * 5. When avatar_display URL is present Mantine renders a real <img>; the letter-initial
 *    fallback only appears when avatar_display is absent. The avatar image test scopes
 *    to the instructor card section to avoid alt-text brittleness.
 * 6. Mantine skeletons use .mantine-Skeleton-root class.
 *    OnboardingLoader (shown during completion mutation) renders a Mantine v5 <Loader>
 *    which is a bare <svg role="presentation"> — no wrapper div, no .mantine-Loader-root.
 * 7. Mantine notifications land in a DOM portal as role="alert".
 * 8. Tests are parallel-safe; each runs in its own page context.
 *
 * LOCATOR MAP
 * startLearningBtn   — getByRole('button', { name: /start learning/i })
 * loader             — .mantine-Skeleton-root (first)
 * editBtnFor(label)  — div filtered by label text + has Edit button → Edit button (first)
 * notification       — role=alert
 *
 * EDIT BUTTON CARD LABELS (regex matching visible section text):
 *   instructor       — /your instructor/i
 *   voice            — /voice preference/i
 *   communication    — /communication preference/i
 *   learning goals   — /your learning goals/i
 *   interests        — /your interests/i
 *
 * RECOMMENDED TEST-ID HOOKS TO ADD IN APP CODE:
 *   data-testid="summary-instructor-card"    on the instructor card container
 *   data-testid="summary-voice-card"         on the voice preference card
 *   data-testid="summary-communication-card" on the communication card
 *   data-testid="summary-goals-card"         on the learning goals card
 *   data-testid="summary-interests-card"     on the interests card
 *   data-testid="summary-start-learning-btn" on the Start Learning button
 *   data-testid="summary-skeleton"           on the skeleton wrapper
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SUMMARY_URL = '/onboarding/summary';

// ---------------------------------------------------------------------------
// Selector map
// ---------------------------------------------------------------------------
const SELECTORS = {
  loader: '.mantine-Skeleton-root',
  notification: '[role="alert"]',
} as const;

// ---------------------------------------------------------------------------
// Test data — shapes match real API response
// ---------------------------------------------------------------------------
const AVATAR = {
  uuid: 'cf03a785-187e-4ec4-9aeb-ec7144816efe',
  name: 'Quibli',
  description: 'Quibli Cartoon',
  avatar_display: 'https://cdn.example.com/quibli.png',
};

// audio_model is a wrapper object; the model details live inside audio_model.audio_model
const AUDIO_MODEL = {
  uuid: '9cc388e3-b3a7-495a-bf16-5b51ad968e7c',
  audio_model: {
    name: 'Azure BrianMultilingualNeural',
    description: 'BrianMultilingualNeural',
    category: {
      uuid: 'cde83438-bb06-4954-a0f6-461fd52e27e0',
      key: 'Professional',
      type: 'audio-model-category',
      order: 2,
    },
  },
};

const INTERESTS = [
  { uuid: 'int-uuid-1', key: 'Food-Cooking',          label: 'Food & Cooking' },
  { uuid: 'int-uuid-2', key: 'Music-Performing-Arts', label: 'Music & Performing Arts' },
  { uuid: 'int-uuid-3', key: 'Technology-Gadgets',    label: 'Technology & Gadgets' },
];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
interface AudioModelWrapper {
  uuid: string;
  audio_model: {
    name: string;
    description: string;
    category: { uuid: string; key: string; type: string; order: number };
  };
}

interface Interest {
  uuid: string;
  key: string;
  label: string; // mapped to translations[0].value in the builder
}

interface UserPreference {
  learning_preference?: 'avatar' | 'voice' | 'text';
  avatar: typeof AVATAR;
  audio_model?: AudioModelWrapper;
  current_focus?: string;
  career_growth?: string;
  interests: Interest[];
}

type SetupOpts = {
  pref?: Partial<UserPreference>;
  completeFail?: boolean;
  prefFail?: boolean;
};

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function buildUserPreferenceResponse(pref: Partial<UserPreference> = {}) {
  const merged: UserPreference = {
    learning_preference: 'avatar',
    avatar: AVATAR,
    audio_model: AUDIO_MODEL,
    current_focus: 'Not sure what to focus on right now; need help choosing a direction.',
    career_growth: 'Not sure yet where to grow next; need help exploring options.',
    interests: INTERESTS,
    ...pref,
  };

  return {
    data: {
      learning_preference: merged.learning_preference,
      avatar: merged.avatar,
      audio_model: merged.audio_model,
      current_focus: merged.current_focus,
      career_growth: merged.career_growth,
      interests: merged.interests.map((i) => ({
        uuid: i.uuid,
        key: i.key,
        translations: [{ uuid: `trans-${i.uuid}`, language: 'EN', value: i.label }],
      })),
    },
  };
}

function buildCompleteSuccessResponse() {
  return { data: { success: true } };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
async function mockUserPreferenceApi(page: Page, pref: Partial<UserPreference> = {}) {
  await page.route('**/onboarding/user-preferences**', (route: Route) => {
    if (
      route.request().resourceType() !== 'fetch' &&
      route.request().resourceType() !== 'xhr'
    ) {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildUserPreferenceResponse(pref)),
    });
  });
}

async function mockUserPreferenceApiError(page: Page) {
  await page.route('**/onboarding/user-preferences**', (route: Route) => {
    if (
      route.request().resourceType() !== 'fetch' &&
      route.request().resourceType() !== 'xhr'
    ) {
      return route.continue();
    }
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal server error' }),
    });
  });
}

async function mockCompleteApi(page: Page, { fail = false }: { fail?: boolean } = {}) {
  await page.route('**/onboarding/complete**', (route: Route) => {
    if (route.request().method() === 'GET') return route.continue();
    if (fail) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Completion failed' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildCompleteSuccessResponse()),
    });
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const startLearningBtn = (page: Page) =>
  page.getByRole('button', { name: /start learning/i });

// Mantine Skeleton — visible while user-preferences data is loading.
const loader = (page: Page) => page.locator(SELECTORS.loader).first();

// Mantine v5 Loader renders as <svg role="presentation"> directly (no wrapper div class).
const onboardingLoader = (page: Page) => page.locator('svg[role="presentation"]').first();

const notification = (page: Page) => page.locator(SELECTORS.notification);

// Scope an Edit button to the Mantine Card that contains the given section label.
// Using .mantine-Card-root instead of div prevents ancestor containers (which also
// contain the label text) from matching and returning the wrong Edit button.
const editBtnFor = (page: Page, cardLabel: string | RegExp) =>
  page
    .locator('.mantine-Card-root')
    .filter({ hasText: cardLabel })
    .getByRole('button', { name: /edit/i })
    .first();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
async function setupPage(page: Page, opts: SetupOpts = {}) {
  const { pref = {}, completeFail = false, prefFail = false } = opts;
  if (prefFail) {
    await mockUserPreferenceApiError(page);
  } else {
    await mockUserPreferenceApi(page, pref);
  }
  await mockCompleteApi(page, { fail: completeFail });
}

// Navigate to summary and wait until the page has fully rendered.
// All tests in groups B–E call this instead of duplicating goto + wait.
async function gotoSummary(page: Page, opts: SetupOpts = {}) {
  await setupPage(page, opts);
  await page.goto(SUMMARY_URL);
  await expect(startLearningBtn(page)).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Summary page', () => {
  // -------------------------------------------------------------------------
  // Authentication
  // NOTE: summary.tsx currently has no active getServerSideProps auth gate
  // (commented out). Until the app re-enables SSR auth or adds middleware,
  // there is no redirect to assert against. See ARD onboarding audit.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // A) Loading state
  // -------------------------------------------------------------------------
  test.describe('A) Loading state', () => {
    test('shows skeleton loader while user-preference API is pending', async ({ page }) => {
      let resolvePrefs!: () => void;
      const prefsGate = new Promise<void>((r) => { resolvePrefs = r; });

      await page.route('**/onboarding/user-preferences**', async (route: Route) => {
        if (
          route.request().resourceType() !== 'fetch' &&
          route.request().resourceType() !== 'xhr'
        ) {
          return route.continue();
        }
        await prefsGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildUserPreferenceResponse()),
        });
      });
      await mockCompleteApi(page);

      await page.goto(SUMMARY_URL);
      await expect(loader(page)).toBeVisible({ timeout: 10000 });

      resolvePrefs();
      await expect(startLearningBtn(page)).toBeVisible({ timeout: 10000 });
    });

    test('skeleton disappears once data is loaded', async ({ page }) => {
      await gotoSummary(page);
      await expect(loader(page)).not.toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // B) Full render
  // -------------------------------------------------------------------------
  test.describe('B) Full render', () => {
    test('renders page heading', async ({ page }) => {
      await gotoSummary(page);
      await expect(page.getByRole('heading', { name: /you're all set/i })).toBeVisible();
    });

    test('renders instructor card with avatar image', async ({ page }) => {
      await gotoSummary(page);
      // The instructor section must contain at least one image element (avatar display or fallback).
      await expect(
        page
          .locator('.mantine-Card-root')
          .filter({ hasText: /your instructor/i })
          .locator('img')
          .first()
      ).toBeVisible();
    });

    test('renders instructor card with avatar name', async ({ page }) => {
      await gotoSummary(page);
      await expect(page.getByText(AVATAR.name)).toBeVisible();
    });

    test('renders voice preference card with audio model category', async ({ page }) => {
      await gotoSummary(page);
      // The component renders audio_model.audio_model.category.key via i18n, not .name.
      await expect(page.getByText(AUDIO_MODEL.audio_model.category.key)).toBeVisible();
    });

    test('renders learning goals card with current_focus text', async ({ page }) => {
      await gotoSummary(page);
      await expect(
        page.getByText('Not sure what to focus on right now; need help choosing a direction.')
      ).toBeVisible();
    });

    test('renders learning goals card with career_growth text', async ({ page }) => {
      await gotoSummary(page);
      await expect(
        page.getByText('Not sure yet where to grow next; need help exploring options.')
      ).toBeVisible();
    });

    test('renders interests card with all interest labels', async ({ page }) => {
      await gotoSummary(page);
      for (const interest of INTERESTS) {
        await expect(page.getByText(interest.label)).toBeVisible();
      }
    });

    test('Start Learning button is visible and enabled', async ({ page }) => {
      await gotoSummary(page);
      await expect(startLearningBtn(page)).toBeEnabled();
    });
  });

  // -------------------------------------------------------------------------
  // C) Edit button navigation
  // -------------------------------------------------------------------------
  test.describe('C) Edit button navigation', () => {
    test('instructor Edit navigates to /onboarding/avatars?redirect=summary', async ({ page }) => {
      await gotoSummary(page);
      await editBtnFor(page, /your instructor/i).click();
      await expect(page).toHaveURL(/\/onboarding\/avatars\?redirect=summary/, { timeout: 10000 });
    });

    test('voice Edit navigates to /onboarding/avatars with audio-model tab and avatarId', async ({ page }) => {
      await gotoSummary(page);
      await editBtnFor(page, /voice preference/i).click();
      await expect(page).toHaveURL(
        new RegExp(`/onboarding/avatars\\?tab=audio-model&avatarId=${AVATAR.uuid}&redirect=summary`),
        { timeout: 10000 }
      );
    });

    test('communication preference Edit navigates to /onboarding/preference?redirect=summary', async ({ page }) => {
      await gotoSummary(page);
      await editBtnFor(page, /communication preference/i).click();
      await expect(page).toHaveURL(/\/onboarding\/preference\?redirect=summary/, { timeout: 10000 });
    });

    test('learning goals Edit navigates to /onboarding/tour/avatar?redirect=summary when learning_preference is avatar', async ({ page }) => {
      await gotoSummary(page, { pref: { learning_preference: 'avatar' } });
      await editBtnFor(page, /your learning goals/i).click();
      await expect(page).toHaveURL(/\/onboarding\/tour\/avatar\?redirect=summary/, { timeout: 10000 });
    });

    test('learning goals Edit navigates to /onboarding/tour/audio?redirect=summary when learning_preference is voice', async ({ page }) => {
      await gotoSummary(page, { pref: { learning_preference: 'voice' } });
      await editBtnFor(page, /your learning goals/i).click();
      await expect(page).toHaveURL(/\/onboarding\/tour\/audio\?redirect=summary/, { timeout: 10000 });
    });

    test('learning goals Edit navigates to /onboarding/tour/text?redirect=summary when learning_preference is text', async ({ page }) => {
      await gotoSummary(page, { pref: { learning_preference: 'text' } });
      await editBtnFor(page, /your learning goals/i).click();
      await expect(page).toHaveURL(/\/onboarding\/tour\/text\?redirect=summary/, { timeout: 10000 });
    });

    test('learning goals Edit falls back to /onboarding/tour/text when learning_preference is absent', async ({ page }) => {
      await gotoSummary(page, { pref: { learning_preference: undefined } });
      await editBtnFor(page, /your learning goals/i).click();
      await expect(page).toHaveURL(/\/onboarding\/tour\/text\?redirect=summary/, { timeout: 10000 });
    });

    test('interests Edit navigates to /onboarding/tour/interests?redirect=summary', async ({ page }) => {
      await gotoSummary(page);
      await editBtnFor(page, /your interests/i).click();
      await expect(page).toHaveURL(/\/onboarding\/tour\/interests\?redirect=summary/, { timeout: 10000 });
    });
  });

  // -------------------------------------------------------------------------
  // D) Start Learning button
  // -------------------------------------------------------------------------
  test.describe('D) Start Learning button', () => {
    test('redirects to /dashboard on successful completion', async ({ page }) => {
      await gotoSummary(page);
      await Promise.all([
        page.waitForURL(/\/dashboard/, { timeout: 10000 }),
        startLearningBtn(page).click(),
      ]);
    });

    test('disables button and shows loader while completion is pending', async ({ page }) => {
      let resolveComplete!: () => void;
      const completeGate = new Promise<void>((r) => { resolveComplete = r; });

      await mockUserPreferenceApi(page);
      await page.route('**/onboarding/complete**', async (route: Route) => {
        if (route.request().method() === 'GET') return route.continue();
        await completeGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(buildCompleteSuccessResponse()),
        });
      });

      await page.goto(SUMMARY_URL);
      await expect(startLearningBtn(page)).toBeEnabled({ timeout: 10000 });

      await startLearningBtn(page).click();

      await expect(startLearningBtn(page)).toBeDisabled();
      await expect(onboardingLoader(page)).toBeVisible();

      resolveComplete();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('shows error notification when completion API fails', async ({ page }) => {
      await gotoSummary(page, { completeFail: true });
      await startLearningBtn(page).click();
      await expect(notification(page).first()).toBeVisible({ timeout: 10000 });
    });

    test('remains on summary page when completion API fails', async ({ page }) => {
      await gotoSummary(page, { completeFail: true });
      await startLearningBtn(page).click();
      await expect(notification(page).first()).toBeVisible({ timeout: 10000 });
      await expect(page).toHaveURL(new RegExp(SUMMARY_URL));
    });
  });

  // -------------------------------------------------------------------------
  // E) Conditional rendering
  // -------------------------------------------------------------------------
  test.describe('E) Conditional rendering', () => {
    test('hides current_focus text when current_focus is absent', async ({ page }) => {
      await gotoSummary(page, { pref: { current_focus: undefined } });
      await expect(
        page.getByText('Not sure what to focus on right now; need help choosing a direction.')
      ).not.toBeVisible();
    });

    test('hides career_growth text when career_growth is absent', async ({ page }) => {
      await gotoSummary(page, { pref: { career_growth: undefined } });
      await expect(
        page.getByText('Not sure yet where to grow next; need help exploring options.')
      ).not.toBeVisible();
    });

    test('interests card renders only the interests returned by the API', async ({ page }) => {
      const twoInterests = INTERESTS.slice(0, 2);
      await gotoSummary(page, { pref: { interests: twoInterests } });

      for (const interest of twoInterests) {
        await expect(page.getByText(interest.label)).toBeVisible();
      }
      await expect(page.getByText(INTERESTS[2].label)).not.toBeVisible();
    });

    test('interests card renders all interests when full list is returned', async ({ page }) => {
      await gotoSummary(page);
      for (const interest of INTERESTS) {
        await expect(page.getByText(interest.label)).toBeVisible();
      }
    });

    test('voice card category text is absent when audio_model is not returned', async ({ page }) => {
      await gotoSummary(page, { pref: { audio_model: undefined } });
      // The voice card itself is always rendered; only the category label disappears.
      await expect(editBtnFor(page, /voice preference/i)).toBeVisible();
      await expect(page.getByText(AUDIO_MODEL.audio_model.category.key)).not.toBeVisible();
    });
  });
});
