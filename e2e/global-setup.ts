import { chromium, FullConfig } from '@playwright/test';
import path from 'path';

export const AUTH_FILE = path.join(__dirname, 'playwright/.auth/user.json');

export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/auth/signIn`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  const preStepButton = page.locator('//*[@id="__next"]/div/div/div[1]/form/div/div/button');
  const emailInput = page.locator('[data-test="email-input"]');

  // Wait for the form to be ready. Some deployments show a pre-step button
  // that must be clicked to reveal the email/password fields; others show the
  // fields directly. Wait for the email input first (its own generous timeout),
  // and only click the pre-step button if it happens to appear quickly.
  try {
    await preStepButton.waitFor({ timeout: 3000 });
    await preStepButton.click();
  } catch {
    // Pre-step button not present on this deployment — proceed.
  }

  await emailInput.waitFor({ timeout: 30000 });

  await emailInput.fill(process.env.TEST_EMAIL!);
  await page.locator('[data-test="password-input"]').fill(process.env.TEST_PASSWORD!);
  await page.locator('button[type="submit"][data-button="true"]').click();

  // Wait until redirected away from sign-in (dashboard or onboarding)
  await page.waitForURL((url) => !url.pathname.includes('/auth/signIn'), {
    timeout: 20000,
  });

  // Save authenticated session (cookies + localStorage) for test reuse
  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();
}
