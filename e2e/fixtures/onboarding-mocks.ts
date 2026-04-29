import { Page } from '@playwright/test';
import { ApiMocker } from './api-mock';

// ── Canonical mock shapes ────────────────────────────────────────────────────

export const MOCK_AVATARS = [
  { id: 'avatar-1', name: 'Alex', imageUrl: '/avatars/alex.png', isSelected: false },
  { id: 'avatar-2', name: 'Sam',  imageUrl: '/avatars/sam.png',  isSelected: false },
];

export const MOCK_AUDIO_MODELS = [
  { id: 'audio-1', name: 'Natural', previewUrl: null },
  { id: 'audio-2', name: 'Warm',    previewUrl: null },
];

export const MOCK_AUDIO_MESSAGES = [
  { role: 'assistant', content: 'Hello, I am your assistant.' },
];

export const MOCK_PREFERENCES = {
  learningMode: 'guided',
  language: 'en',
};

export const MOCK_WELCOME_MESSAGE = { message: 'Welcome to Ardoise!' };

export const MOCK_ORG_AVATAR = { url: '/org/avatar.png', name: 'My Org' };

export const MOCK_INTERESTS = [
  { id: 'int-1', name: 'Technology', selected: false },
  { id: 'int-2', name: 'Business',   selected: false },
  { id: 'int-3', name: 'Science',    selected: false },
];

// ── Helper: wraps data in the standard { data: ... } envelope ───────────────

function envelope<T>(data: T) {
  return { data };
}

// ── OnboardingMocks ──────────────────────────────────────────────────────────

export class OnboardingMocks {
  constructor(private mocker: ApiMocker) {}

  async mockAll(avatarId = 'avatar-1', audioModelId = 'audio-1'): Promise<void> {
    await Promise.all([
      this.avatars(),
      this.putAvatar(avatarId),
      this.audioMessages(avatarId),
      this.putAudioModel(avatarId, audioModelId),
      this.userPreferences(),
      this.welcomeMessage(),
      this.orgAvatar(),
      this.interests(),
      this.putInterests(),
      this.putComplete(),
    ]);
  }

  async avatars(overrides: typeof MOCK_AVATARS = MOCK_AVATARS): Promise<void> {
    await this.mocker.mockGet('**/o/user/onboarding/avatars', envelope(overrides));
  }

  async avatarsEmpty(): Promise<void> {
    await this.mocker.mockGet('**/o/user/onboarding/avatars', envelope([]));
  }

  async avatarsError(): Promise<void> {
    await this.mocker.mockError('**/o/user/onboarding/avatars', 500, 'Failed to load avatars');
  }

  async putAvatar(avatarId: string): Promise<void> {
    await this.mocker.mockGet(
      `**/o/user/onboarding/avatar/${avatarId}`,
      envelope({ id: avatarId, success: true }),
    );
  }

  async audioMessages(avatarId: string): Promise<void> {
    await this.mocker.mockGet(
      `**/o/user/onboarding/audio-model/${avatarId}/messages`,
      envelope(MOCK_AUDIO_MESSAGES),
    );
  }

  async putAudioModel(avatarId: string, audioModelId: string): Promise<void> {
    await this.mocker.mockGet(
      `**/o/user/onboarding/audio-model/${avatarId}`,
      envelope({ id: audioModelId, success: true }),
    );
  }

  async userPreferences(): Promise<void> {
    await this.mocker.mockGet(
      '**/o/user/onboarding/user-preferences',
      envelope(MOCK_PREFERENCES),
    );
  }

  async welcomeMessage(): Promise<void> {
    await this.mocker.mockGet(
      '**/o/user/onboarding/welcome-message',
      envelope(MOCK_WELCOME_MESSAGE),
    );
  }

  async orgAvatar(): Promise<void> {
    await this.mocker.mockGet(
      '**/o/user/profile/org-avatar',
      envelope(MOCK_ORG_AVATAR),
    );
  }

  async interests(overrides: typeof MOCK_INTERESTS = MOCK_INTERESTS): Promise<void> {
    await this.mocker.mockGet('**/o/user/onboarding/interests', envelope(overrides));
  }

  async putInterests(): Promise<void> {
    await this.mocker.mock('**/o/user/onboarding/interests', {
      status: 200,
      body: envelope({ success: true }),
    });
  }

  async putComplete(): Promise<void> {
    await this.mocker.mock('**/o/user/onboarding/complete', {
      status: 200,
      body: envelope({ success: true }),
    });
  }

  async interceptPutComplete(page: Page): Promise<{ calls: Request[] }> {
    const calls: Request[] = [];
    await page.route('**/o/user/onboarding/complete', async (route) => {
      calls.push(route.request() as unknown as Request);
      await route.fulfill({ status: 200, body: JSON.stringify(envelope({ success: true })) });
    });
    return { calls };
  }
}
