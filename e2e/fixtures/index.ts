import { test as base, expect } from '@playwright/test';
import { AuthenticatedPage } from './authenticated-page';
import { ApiMocker } from './api-mock';
import { AccessibilityHelper } from './accessibility';
import { NetworkLogger } from './network-logger';

type CustomFixtures = {
  authenticatedPage: AuthenticatedPage;
  apiMocker: ApiMocker;
  a11y: AccessibilityHelper;
  networkLogger: NetworkLogger;
};

export const test = base.extend<CustomFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await use(new AuthenticatedPage(page));
  },
  apiMocker: async ({ page }, use) => {
    const mocker = new ApiMocker(page);
    await use(mocker);
    await mocker.removeAll();
  },
  a11y: async ({ page }, use) => {
    await use(new AccessibilityHelper(page));
  },
  // auto:true — runs for every test automatically, no need to declare it in each spec
  networkLogger: [async ({ page }, use, testInfo) => {
    const logger = new NetworkLogger();
    logger.attach(page);
    await use(logger);
    await logger.saveToTest(testInfo);
  }, { auto: true }],
});

export { expect };
