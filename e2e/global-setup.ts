import path from 'path';
import fs from 'fs';
import { chromium } from '@playwright/test';

const AUTH_DIR = path.join(__dirname, '.auth');
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

interface AppConfig {
  name: string;
  baseUrl: string;
  apiUrl: string;
  loginPath: string;
  email: string;
  password: string;
  token?: string;
  storageFile: string;
  useBrowserLogin?: boolean; // use real browser to click Google login
}

/** Returns true if the cached storageState is still fresh */
function isCacheValid(storagePath: string): boolean {
  if (!fs.existsSync(storagePath)) return false;
  const ageMs = Date.now() - fs.statSync(storagePath).mtimeMs;
  return ageMs < CACHE_TTL_MS;
}

/**
 * Call the backend login endpoint directly — no browser required.
 */
async function fetchToken(
  apiUrl: string,
  loginPath: string,
  email: string,
  password: string,
  domain: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const url = `${apiUrl}${loginPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ardoise-Domain': domain },
    body: JSON.stringify({ email, password }),
  });

  const json = await res.json() as Record<string, any>;
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${json?.errors || json?.error?.message || JSON.stringify(json)}`);
  }

  const data: Record<string, any> = json.data ?? json;
  const accessToken: string = data.access_token ?? data.accessToken ?? data.token;
  const refreshToken: string = data.refresh_token ?? data.refreshToken ?? '';
  const expiresIn: number = data.expires_in ?? 3600;

  if (!accessToken) throw new Error(`No access_token in response: ${JSON.stringify(json)}`);
  return { accessToken, refreshToken, expiresIn };
}

function buildStorageState(appUrl: string, accessToken: string, refreshToken: string, expiresIn: number): object {
  const expiresMs = Date.now() + expiresIn * 1000;
  const domain = new URL(appUrl).hostname;
  return {
    cookies: [
      { name: 'accessToken', value: accessToken, domain, path: '/', expires: Math.floor(expiresMs / 1000), httpOnly: false, secure: appUrl.startsWith('https'), sameSite: 'Lax' },
      ...(refreshToken ? [{ name: 'refreshToken', value: refreshToken, domain, path: '/', expires: Math.floor(expiresMs / 1000), httpOnly: false, secure: appUrl.startsWith('https'), sameSite: 'Lax' }] : []),
      { name: 'accessTokenExpires', value: String(expiresMs), domain, path: '/', expires: Math.floor(expiresMs / 1000), httpOnly: false, secure: appUrl.startsWith('https'), sameSite: 'Lax' },
    ],
    origins: [{ origin: appUrl, localStorage: [{ name: 'accessToken', value: accessToken }] }],
  };
}

/**
 * MC uses Google SSO — opens a real browser window.
 * - If already logged in (session cookie exists in Chrome profile): saves session immediately.
 * - If not logged in: opens the login page, waits for user to click Google and complete login.
 *   Once redirected away from /auth/signIn, saves the full session.
 */
async function browserLoginMC(app: AppConfig, storagePath: string): Promise<void> {
  console.log(`\n[${app.name}] Opening browser for Google login...`);

  const browser = await chromium.launch({
    headless: false,  // must be visible so user can click Google
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: null,
  });

  const page = await context.newPage();

  try {
    await page.goto(`${app.baseUrl}/auth/signIn`, { waitUntil: 'domcontentloaded' });

    const currentUrl = page.url();

    // Already logged in — session active, redirected away from signIn
    if (!currentUrl.includes('/auth/signIn')) {
      console.log(`[${app.name}] Already logged in — session is active.`);
    } else {
      console.log(`[${app.name}] Not logged in. Please click "Google" in the browser window...`);

      // Wait up to 2 minutes for user to complete Google login
      await page.waitForURL(
        (url) => !url.pathname.includes('/auth/') && !url.hostname.includes('google.com') && !url.hostname.includes('accounts.google'),
        { timeout: 120_000 }
      );

      console.log(`[${app.name}] Login successful — landed on: ${page.url()}`);
    }

    // Save the full session (includes next-auth.session-token + accessToken)
    await context.storageState({ path: storagePath });
    console.log(`[${app.name}] Session saved → ${app.storageFile}`);
  } finally {
    await browser.close();
  }
}

/**
 * UI / Studio-Web — email+password login via browser form ("Se connecter" button).
 * Opens a headed browser, fills credentials, waits for /dashboard, saves session.
 * Session cached for 23 hours — browser only opens when cache is stale.
 */
async function browserLoginEmailPassword(app: AppConfig, storagePath: string): Promise<void> {
  console.log(`\n[${app.name}] Opening browser for email/password login...`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: null,
  });

  const page = await context.newPage();

  try {
    await page.goto(`${app.baseUrl}/auth/signIn`, { waitUntil: 'domcontentloaded' });

    // Check if already logged in (redirected away from signIn)
    if (!page.url().includes('/auth/signIn')) {
      console.log(`[${app.name}] Already logged in — session is active.`);
    } else {
      // Click "Se connecter" / email login button
      await page.getByRole('button', { name: /se connecter/i }).first().click();

      // Fill credentials
      await page.locator('[data-test="email-input"]').fill(app.email);
      await page.locator('[data-test="password-input"]').fill(app.password);

      // Submit
      await page.getByRole('button', { name: /se connecter/i }).click();

      // Wait for redirect away from /auth/ (may land on /dashboard or /onboarding/*)
      await page.waitForURL((url) => !url.pathname.includes('/auth/'), { timeout: 60_000 });
      await page.waitForTimeout(3000); // buffer for SPA auth token setup

      console.log(`[${app.name}] Login successful — landed on: ${page.url()}`);
    }

    await context.storageState({ path: storagePath });
    console.log(`[${app.name}] Session saved → ${app.storageFile}`);
  } finally {
    await browser.close();
  }
}

async function authenticateApp(app: AppConfig): Promise<void> {
  if (!app.baseUrl) {
    console.warn(`[${app.name}] Skipping — URL not set in .env.e2e`);
    return;
  }

  const storagePath = path.join(AUTH_DIR, app.storageFile);

  if (isCacheValid(storagePath)) {
    const ageMin = Math.round((Date.now() - fs.statSync(storagePath).mtimeMs) / 60_000);
    console.log(`[${app.name}] Reusing cached session (${ageMin} min old).`);
    return;
  }

  // MC: Google SSO — use real browser login
  if (app.useBrowserLogin) {
    await browserLoginMC(app, storagePath);
    return;
  }

  // UI / SW: browser form login (Se connecter button)
  if (!app.email || !app.password) {
    console.warn(`[${app.name}] Skipping — no email/password set in .env.e2e`);
    return;
  }

  await browserLoginEmailPassword(app, storagePath);
}

async function globalSetup(): Promise<void> {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const apps: AppConfig[] = [
    {
      name: 'UI',
      baseUrl: process.env.PLAYWRIGHT_UI_URL || '',
      apiUrl: '',
      loginPath: '',
      email: process.env.PLAYWRIGHT_UI_EMAIL || '',
      password: process.env.PLAYWRIGHT_UI_PASSWORD || '',
      storageFile: 'ui-user.json',
    },
    {
      name: 'Mission-Control',
      baseUrl: process.env.PLAYWRIGHT_MC_URL || '',
      apiUrl: '',
      loginPath: '',
      email: '',
      password: '',
      useBrowserLogin: true,  // Google SSO — opens browser window
      storageFile: 'mc-user.json',
    },
    {
      name: 'Studio-Web',
      baseUrl: (process.env.PLAYWRIGHT_SW_URL || '').replace(/\/studio.*$/, ''), // strip path, keep origin only
      apiUrl: '',
      loginPath: '',
      email: process.env.PLAYWRIGHT_SW_EMAIL || '',
      password: process.env.PLAYWRIGHT_SW_PASSWORD || '',
      storageFile: 'sw-user.json',
    },
  ];

  // MC must run first (it opens a browser window — interactive)
  // UI and SW can run after in parallel
  const mc = apps.find(a => a.name === 'Mission-Control')!;
  const rest = apps.filter(a => a.name !== 'Mission-Control');

  await authenticateApp(mc);
  await Promise.all(rest.map(authenticateApp));
}

export default globalSetup;
