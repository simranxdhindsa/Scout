import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const AVATARS_URL = '/onboarding/avatars';
const SIGN_IN_URL = '/auth/signIn';

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
interface OrgAudioModel {
  uuid: string;
  audio_model: {
    name: string;
    description: string;
    category: {
      uuid: string;
      key: string;
      type: string;
      order: number;
    };
  };
  is_default: boolean;
}

interface Avatar {
  uuid: string;
  name: string;
  avatar_display?: string;
  org_audio_models?: OrgAudioModel[];
}

function buildAvatar(overrides: Partial<Avatar> & { uuid: string; name: string }): Avatar {
  return {
    avatar_display: `https://example.com/avatars/${overrides.uuid}.png`,
    org_audio_models: [],
    ...overrides,
  };
}

function buildOrgAudioModel(overrides: { uuid: string; name: string; isDefault?: boolean }): OrgAudioModel {
  return {
    uuid: overrides.uuid,
    audio_model: {
      name: overrides.name,
      description: overrides.name,
      category: {
        uuid: 'category-uuid-1',
        key: 'Professional',
        type: 'audio-model-category',
        order: 1,
      },
    },
    is_default: overrides.isDefault ?? false,
  };
}

const AVATAR_WITH_AUDIO = buildAvatar({
  uuid: 'avatar-uuid-1',
  name: 'Emma',
  org_audio_models: [buildOrgAudioModel({ uuid: 'audio-uuid-1', name: 'Emma Natural', isDefault: true })],
});

const AVATAR_WITHOUT_AUDIO = buildAvatar({
  uuid: 'avatar-uuid-2',
  name: 'James',
  org_audio_models: [],
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
async function mockAvatarsApi(page: Page, avatars: Avatar[]) {
  await page.route('**/onboarding/avatars**', (route) => {
    if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: avatars }),
    });
  });
}

async function mockUserPreferencesApi(page: Page, selectedAvatarOrgUuid: string | null = null) {
  // AvatarList.tsx pre-selection logic reads userPreference.data.avatar.org_avatar_uuid
  // (not a flat avatar_uuid field). audioModel.tsx reads userPreference.data.audio_model.uuid.
  //
  // When no avatar is pre-selected, omit `avatar` entirely. Emitting
  // `{ avatar: null }` would change the useEffect dependency and cause the
  // matcher to run with `undefined === undefined`, which silently selects the
  // first avatar that has no `org_avatar_uuid` field.
  await page.route('**/onboarding/user-preferences**', (route) => {
    if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
      return route.continue();
    }
    const data: Record<string, unknown> = {};
    if (selectedAvatarOrgUuid) data.avatar = { org_avatar_uuid: selectedAvatarOrgUuid };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data }),
    });
  });
}

async function mockAudioModelMessagesApi(page: Page, audioUrl = 'https://cdn.example.com/sample.mp3') {
  // Real endpoint: GET /o/user/onboarding/audio-model/{id}/messages.
  // useGetAudioModelMessages reads res.data?.[0]?.audio_url and res.data[0] generally.
  await page.route('**/onboarding/audio-model/*/messages**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ audio_url: audioUrl, message: 'Hi there' }] }),
    });
  });
}

async function mockAddAudioModelApi(page: Page) {
  // Real endpoint: PUT /o/user/onboarding/audio-model/{id}
  await page.route('**/onboarding/audio-model/*', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    });
  });
}

async function mockSaveAvatarApi(page: Page, avatars: Avatar[]) {
  await page.route('**/onboarding/avatar/**', (route) => {
    if (route.request().method() !== 'PUT') {
      return route.continue();
    }
    const segments = new URL(route.request().url()).pathname.split('/');
    const uuid = segments[segments.length - 1];
    const avatar = avatars.find((a) => a.uuid === uuid);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: avatar ?? { success: true } }),
    });
  });
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
const headingChooseInstructor = (page: Page) =>
  page.getByRole('heading', { name: 'Choose your instructor' });

const subtitle = (page: Page) =>
  page.getByText('You can change this at any time later');

const continueBtn = (page: Page) =>
  page.getByRole('button', { name: 'Continue' });


const noInstructorMsg = (page: Page) =>
  page.getByText('No instructors available for this language.');

const avatarCardByName = (page: Page, name: string) =>
  page.locator(`[data-testid="avatar-card"]`).filter({ hasText: name });

const chooseVoiceHeading = (page: Page) =>
  page.locator(`xpath=//h1[contains(normalize-space(), "Choose") and contains(normalize-space(), "voice")]`);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Onboarding — Avatars page', () => {
  test.describe('Authentication', () => {
    test('unauthenticated user is redirected to /auth/signIn', async ({ browser }) => {
      // Fresh context with no stored session — simulates an unauthenticated user
      const context = await browser.newContext({ storageState: undefined });
      const page = await context.newPage();
      await page.goto(AVATARS_URL);
      await expect(page).toHaveURL(new RegExp(SIGN_IN_URL));
      await context.close();
    });
  });

  test.describe('Avatar selection (default tab)', () => {
    test.beforeEach(async ({ page }) => {
      await mockAvatarsApi(page, [AVATAR_WITH_AUDIO, AVATAR_WITHOUT_AUDIO]);
      await mockUserPreferencesApi(page, null);
      await mockSaveAvatarApi(page, [AVATAR_WITH_AUDIO, AVATAR_WITHOUT_AUDIO]);
    });

    test('renders avatar selection screen with heading and subtitle', async ({ page }) => {
      await page.goto(AVATARS_URL);

      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });
      await expect(subtitle(page)).toBeVisible();
    });

    test('Continue button is disabled before selecting an avatar', async ({ page }) => {
      await page.goto(AVATARS_URL);

      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });
      await expect(continueBtn(page)).toBeDisabled();
    });

    test('selecting an avatar enables the Continue button', async ({ page }) => {
      await page.goto(AVATARS_URL);

      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });
      await avatarCardByName(page, 'Emma').click();
      await expect(continueBtn(page)).toBeEnabled();
    });

    test('Continue navigates to audio-model tab when avatar has audio models', async ({ page }) => {
      await page.goto(AVATARS_URL);

      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });
      await avatarCardByName(page, 'Emma').click();
      await continueBtn(page).click();

      await expect(page).toHaveURL(
        new RegExp(`tab=audio-model&avatarId=${AVATAR_WITH_AUDIO.uuid}`)
      );
    });

    test('Continue navigates to /onboarding/preference when avatar has no audio models', async ({ page }) => {
      await page.goto(AVATARS_URL);

      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });
      await avatarCardByName(page, 'James').click();
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/preference/);
    });
  });

  test.describe('Audio model tab', () => {
    test.beforeEach(async ({ page }) => {
      await mockAvatarsApi(page, [AVATAR_WITH_AUDIO]);
      await mockUserPreferencesApi(page, AVATAR_WITH_AUDIO.uuid);
      await mockSaveAvatarApi(page, [AVATAR_WITH_AUDIO]);
    });

    test('?tab=audio-model renders audio model selection UI', async ({ page }) => {
      await page.goto(`${AVATARS_URL}?tab=audio-model&avatarId=${AVATAR_WITH_AUDIO.uuid}`);

      await expect(chooseVoiceHeading(page)).toBeVisible({ timeout: 10000 });
      await expect(chooseVoiceHeading(page)).toContainText('Emma');
    });
  });

  test.describe('Pre-selected avatar from user preference', () => {
    test('avatar matching org_avatar_uuid is selected on load', async ({ page }) => {
      // Source: AvatarList.tsx:42–46 — sets selectedAvatar to the avatar whose
      // org_avatar_uuid matches userPreference.data.avatar.org_avatar_uuid.
      const avatarWithOrgUuid = buildAvatar({
        uuid: 'avatar-uuid-1',
        name: 'Emma',
        org_audio_models: [],
      });
      (avatarWithOrgUuid as any).org_avatar_uuid = 'org-emma-1';

      await mockAvatarsApi(page, [avatarWithOrgUuid, AVATAR_WITHOUT_AUDIO]);
      await mockUserPreferencesApi(page, 'org-emma-1');
      await mockSaveAvatarApi(page, [avatarWithOrgUuid, AVATAR_WITHOUT_AUDIO]);

      await page.goto(AVATARS_URL);
      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });

      // Continue is enabled because selectedAvatar is set automatically.
      await expect(continueBtn(page)).toBeEnabled();
    });
  });

  test.describe('Loading state', () => {
    test('shows 6 skeleton placeholders while avatars API is pending', async ({ page }) => {
      let resolveAvatars!: () => void;
      const avatarsGate = new Promise<void>((r) => { resolveAvatars = r; });

      await page.route('**/onboarding/avatars**', async (route) => {
        if (route.request().resourceType() !== 'fetch' && route.request().resourceType() !== 'xhr') {
          return route.continue();
        }
        await avatarsGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [AVATAR_WITH_AUDIO] }),
        });
      });
      await mockUserPreferencesApi(page, null);
      await mockSaveAvatarApi(page, [AVATAR_WITH_AUDIO]);

      await page.goto(AVATARS_URL);
      // AvatarList renders 6 Skeleton cards while data is loading.
      await expect(page.locator('.mantine-Skeleton-root').first()).toBeVisible({ timeout: 10000 });

      resolveAvatars();
      await expect(avatarCardByName(page, 'Emma')).toBeVisible({ timeout: 10000 });
    });

    test('OnboardingLoader (svg overlay) appears while saving avatar', async ({ page }) => {
      let resolveSave!: () => void;
      const saveGate = new Promise<void>((r) => { resolveSave = r; });

      await mockAvatarsApi(page, [AVATAR_WITHOUT_AUDIO]);
      await mockUserPreferencesApi(page, null);
      await page.route('**/onboarding/avatar/**', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await saveGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { success: true } }),
        });
      });

      await page.goto(AVATARS_URL);
      await expect(headingChooseInstructor(page)).toBeVisible({ timeout: 10000 });
      await avatarCardByName(page, 'James').click();
      await continueBtn(page).click();

      // Mantine v5 Loader renders <svg role="presentation"> directly.
      await expect(page.locator('svg[role="presentation"]').first()).toBeVisible({ timeout: 10000 });

      resolveSave();
      await expect(page).toHaveURL(/\/onboarding\/preference/, { timeout: 10000 });
    });
  });

  test.describe('Audio model tab — selection + continue', () => {
    test.beforeEach(async ({ page }) => {
      await mockAvatarsApi(page, [AVATAR_WITH_AUDIO]);
      await mockUserPreferencesApi(page, null);
      await mockAudioModelMessagesApi(page);
      await mockAddAudioModelApi(page);
    });

    test('Continue is disabled until an audio model is selected', async ({ page }) => {
      await page.goto(`${AVATARS_URL}?tab=audio-model&avatarId=${AVATAR_WITH_AUDIO.uuid}`);
      await expect(chooseVoiceHeading(page)).toBeVisible({ timeout: 10000 });

      // Translated category label is the click target inside the audio model card.
      // 'Professional' is the i18n key fallback for the test fixture.
      await expect(continueBtn(page)).toBeDisabled();
    });

    test('selecting an audio model fetches a preview and enables Continue', async ({ page }) => {
      await page.goto(`${AVATARS_URL}?tab=audio-model&avatarId=${AVATAR_WITH_AUDIO.uuid}`);
      await expect(chooseVoiceHeading(page)).toBeVisible({ timeout: 10000 });

      const [messagesReq] = await Promise.all([
        page.waitForRequest(
          (req) => req.method() === 'GET' && /\/onboarding\/audio-model\/[^/]+\/messages/.test(req.url())
        ),
        page.getByText(/Professional/i).first().click(),
      ]);
      expect(messagesReq.url()).toContain('audio-uuid-1');

      await expect(continueBtn(page)).toBeEnabled({ timeout: 10000 });
    });

    test('Continue routes to /onboarding/preference (no redirect=summary)', async ({ page }) => {
      await page.goto(`${AVATARS_URL}?tab=audio-model&avatarId=${AVATAR_WITH_AUDIO.uuid}`);
      await page.getByText(/Professional/i).first().click();
      await expect(continueBtn(page)).toBeEnabled({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/preference/, { timeout: 10000 });
    });

    test('Continue routes to /onboarding/summary when redirect=summary', async ({ page }) => {
      await page.goto(
        `${AVATARS_URL}?tab=audio-model&avatarId=${AVATAR_WITH_AUDIO.uuid}&redirect=summary`
      );
      await page.getByText(/Professional/i).first().click();
      await expect(continueBtn(page)).toBeEnabled({ timeout: 10000 });
      await continueBtn(page).click();

      await expect(page).toHaveURL(/\/onboarding\/summary/, { timeout: 10000 });
    });
  });

  test.describe('Empty avatar list', () => {
    test.beforeEach(async ({ page }) => {
      await mockAvatarsApi(page, []);
      await mockUserPreferencesApi(page, null);
    });

    test('shows empty-state message', async ({ page }) => {
      await page.goto(AVATARS_URL);

      await expect(noInstructorMsg(page)).toBeVisible({ timeout: 10000 });
    });

  });
});
