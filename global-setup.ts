import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const AUTH_TTL_SECONDS = 82_800; // 23 hours

/**
 * This file is matched by every setup-{product} project in playwright.config.ts.
 * testInfo.project.name is "setup-{product}", so we derive the product name from it.
 */
test('authenticate', async ({ browser }, testInfo) => {
  const product = testInfo.project.name.replace(/^setup-/, '');
  const baseURL = testInfo.project.use.baseURL ?? '';
  const authFile = path.join(__dirname, '.auth', `${product}-user.json`);

  // Skip if the cached session is still fresh.
  if (fs.existsSync(authFile)) {
    const { mtimeMs } = fs.statSync(authFile);
    const ageSeconds = (Date.now() - mtimeMs) / 1000;
    if (ageSeconds < AUTH_TTL_SECONDS) {
      console.log(`[setup-${product}] Auth cache is ${Math.round(ageSeconds / 60)}m old — reusing.`);
      return;
    }
    console.log(`[setup-${product}] Auth cache expired — re-authenticating.`);
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const page = await browser.newPage();

  await page.goto(baseURL);

  // -------------------------------------------------------------------------
  // Replace the block below with the real login flow for each product.
  // Use process.env[`${PRODUCT}_EMAIL`] and `${PRODUCT}_PASSWORD` (set in .env.e2e).
  // -------------------------------------------------------------------------
  const envPrefix = product.toUpperCase().replace(/-/g, '_');
  const email = process.env[`${envPrefix}_EMAIL`] ?? '';
  const password = process.env[`${envPrefix}_PASSWORD`] ?? '';

  if (!email || !password) {
    throw new Error(
      `[setup-${product}] Missing ${envPrefix}_EMAIL or ${envPrefix}_PASSWORD in .env.e2e`,
    );
  }

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click();

  // Wait until redirected away from the login page.
  await page.waitForURL((url) => !url.pathname.match(/login|signin|auth/i), { timeout: 15_000 });
  // -------------------------------------------------------------------------

  await page.context().storageState({ path: authFile });
  console.log(`[setup-${product}] Session saved → ${authFile}`);
  await page.close();
});
