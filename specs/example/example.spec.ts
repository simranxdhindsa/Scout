import { test, expect } from '../../fixtures/network-logger';

test('example test', async ({ page, networkLogger }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);

  // networkLogger is auto-captured; access it if you need runtime assertions:
  // expect(networkLogger.responses.filter(r => r.status >= 500)).toHaveLength(0);
});
