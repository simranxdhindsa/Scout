import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

// Load .env.e2e from root
dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });

const UI_URL  = process.env.PLAYWRIGHT_UI_URL  || '';
const MC_URL  = process.env.PLAYWRIGHT_MC_URL  || '';
const SW_URL  = process.env.PLAYWRIGHT_SW_URL  || '';

const AUTH_DIR = path.join(__dirname, '.auth');

export default defineConfig({
  testDir: path.join(__dirname, 'specs'),
  snapshotDir: path.join(__dirname, 'snapshots'),
  outputDir: path.join(__dirname, 'test-results'),

  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,

  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
    },
    toMatchSnapshot: { maxDiffPixelRatio: 0.01 },
  },

  globalSetup: path.join(__dirname, 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'global-teardown.ts'),

  reporter: [
    ['html', { open: 'never', outputFolder: path.join(__dirname, 'reports', 'html') }],
    ['list'],
    ['json', { outputFile: path.join(__dirname, 'reports', 'results.json') }],
  ],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    ignoreHTTPSErrors: true,
    locale: 'en',
    timezoneId: 'Asia/Kolkata',
  },

  projects: [
    // ── Auth setup ───────────────────────────────────────────────
    {
      name: 'setup-ui',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'setup-sw',
      testMatch: /global-setup\.ts/,
    },

    // ── UI (mocked) ──────────────────────────────────────────────
    {
      name: 'ui',
      testMatch: /specs\/ui\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: UI_URL,
        storageState: path.join(AUTH_DIR, 'ui-user.json'),
      },
      dependencies: ['setup-ui'],
    },
    {
      name: 'ui-no-auth',
      testMatch: /specs\/ui\/auth\/.*/,
      use: { ...devices['Desktop Chrome'], baseURL: UI_URL },
    },

    // ── UI (live — real server) ──────────────────────────────────
    {
      name: 'ui-live',
      testMatch: /specs\/ui-live\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: UI_URL,
        storageState: path.join(AUTH_DIR, 'ui-user.json'),
      },
      dependencies: ['setup-ui'],
    },

    // ── Mission-Control ──────────────────────────────────────────
    {
      name: 'mission-control',
      testMatch: /specs\/mission-control\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: MC_URL,
        storageState: path.join(AUTH_DIR, 'mc-user.json'),
      },
    },
    {
      name: 'mission-control-no-auth',
      testMatch: /specs\/mission-control\/auth\/.*/,
      use: { ...devices['Desktop Chrome'], baseURL: MC_URL },
    },

    // ── Studio-Web (mocked) ──────────────────────────────────────
    {
      name: 'studio-web',
      testMatch: /specs\/studio-web\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: SW_URL,
        storageState: path.join(AUTH_DIR, 'sw-user.json'),
      },
      dependencies: ['setup-sw'],
    },
    {
      name: 'studio-web-no-auth',
      testMatch: /specs\/studio-web\/auth\/.*/,
      use: { ...devices['Desktop Chrome'], baseURL: SW_URL },
    },

    // ── Studio-Web (live — real server) ─────────────────────────
    {
      name: 'studio-web-live',
      testMatch: /specs\/studio-web-live\/.*/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: SW_URL,
        storageState: path.join(AUTH_DIR, 'sw-user.json'),
      },
      dependencies: ['setup-sw'],
    },
  ],
});
