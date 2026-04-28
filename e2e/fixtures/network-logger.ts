import type { Page, TestInfo } from '@playwright/test';

export interface FailedRequest {
  url: string;
  method: string;
  reason: string;
}

export interface ApiError {
  url: string;
  method: string;
  status: number;
  responseSnippet: string;
}

export interface NetworkLogSummary {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: FailedRequest[];
  apiErrors: ApiError[];
}

// URL patterns that are not API calls — skip capturing these as "errors"
const ASSET_PATTERN = /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|eot|gif|webp|map)(\?.*)?$/i;

function isApiUrl(url: string): boolean {
  return (
    url.includes('/api/') ||
    url.includes('/o/auth/') ||
    url.includes('/o/') ||
    (!ASSET_PATTERN.test(url) && !url.includes('/_next/') && !url.includes('/static/'))
  );
}

export class NetworkLogger {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[]    = [];
  readonly failedRequests: FailedRequest[] = [];
  readonly apiErrors: ApiError[]   = [];

  attach(page: Page): void {
    // 1. JS console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(msg.text());
      }
    });

    // 2. Uncaught exceptions / unhandled promise rejections
    page.on('pageerror', (err) => {
      this.pageErrors.push(err.message);
    });

    // 3. Network-level failures (timeout, DNS, blocked)
    page.on('requestfailed', (request) => {
      this.failedRequests.push({
        url:    request.url(),
        method: request.method(),
        reason: request.failure()?.errorText ?? 'unknown',
      });
    });

    // 4. API responses with error status codes (4xx / 5xx)
    page.on('response', async (response) => {
      const status = response.status();
      if (status < 400) return;

      const url = response.url();
      if (!isApiUrl(url)) return;

      let responseSnippet = '';
      try {
        const body = await response.body();
        responseSnippet = body.toString('utf8').slice(0, 300);
      } catch {
        responseSnippet = '(response body unavailable)';
      }

      this.apiErrors.push({
        url,
        method: response.request().method(),
        status,
        responseSnippet,
      });
    });
  }

  hasIssues(): boolean {
    return (
      this.consoleErrors.length   > 0 ||
      this.pageErrors.length      > 0 ||
      this.failedRequests.length  > 0 ||
      this.apiErrors.length       > 0
    );
  }

  getSummary(): NetworkLogSummary {
    return {
      consoleErrors:  [...this.consoleErrors],
      pageErrors:     [...this.pageErrors],
      failedRequests: [...this.failedRequests],
      apiErrors:      [...this.apiErrors],
    };
  }

  /**
   * Called after each test. If any issues were captured, attaches them as
   * 'network-log.json' so they appear in results.json and the dashboard.
   */
  async saveToTest(testInfo: TestInfo): Promise<void> {
    if (!this.hasIssues()) return;
    await testInfo.attach('network-log', {
      body:        Buffer.from(JSON.stringify(this.getSummary(), null, 2)),
      contentType: 'application/json',
    });
  }
}
