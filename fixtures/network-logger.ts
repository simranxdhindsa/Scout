import { test as base, expect } from '@playwright/test';

export { expect };

// Shape written to the "network-log" attachment on every test.
export interface NetworkLog {
  consoleErrors: Array<{ text: string; url: string }>;
  responses: Array<{ url: string; status: number; method: string }>;
  failedRequests: Array<{ url: string; method: string; failure: string }>;
  pageErrors: Array<{ message: string }>;
}

export const test = base.extend<{ networkLogger: NetworkLog }>({
  networkLogger: [
    async ({ page }, use, testInfo) => {
      const log: NetworkLog = {
        consoleErrors: [],
        responses: [],
        failedRequests: [],
        pageErrors: [],
      };

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          log.consoleErrors.push({ text: msg.text(), url: msg.location().url });
        }
      });

      page.on('response', (response) => {
        const status = response.status();
        if (status >= 400) {
          log.responses.push({
            url: response.url(),
            status,
            method: response.request().method(),
          });
        }
      });

      page.on('requestfailed', (request) => {
        log.failedRequests.push({
          url: request.url(),
          method: request.method(),
          failure: request.failure()?.errorText ?? 'unknown',
        });
      });

      page.on('pageerror', (error) => {
        log.pageErrors.push({ message: error.message });
      });

      await use(log);

      await testInfo.attach('network-log', {
        body: JSON.stringify(log),
        contentType: 'application/json',
      });
    },
    { auto: true },
  ],
});
