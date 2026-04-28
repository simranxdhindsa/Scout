/**
 * Optional cleanup spec — deletes a course via API call.
 * Set PLAYWRIGHT_MC_COURSE_UUID env var to the UUID to delete.
 *
 * Usage: npx playwright test course-delete-api.spec.ts --project=mission-control
 */
import { test, expect } from '../../../fixtures';

test.describe('Mission-Control — Course Delete via API (optional cleanup)', () => {
  test('Delete course via DELETE /a/course/{uuid}', async ({ request }) => {
    const courseUuid = process.env.PLAYWRIGHT_MC_COURSE_UUID;
    test.skip(!courseUuid, 'PLAYWRIGHT_MC_COURSE_UUID env var not set — skipping API delete');

    const mcUrl = process.env.PLAYWRIGHT_MC_URL || '';
    const response = await request.delete(`${mcUrl}/a/course/${courseUuid}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);
    console.log(`Course ${courseUuid} deleted via API. Status: ${response.status()}`);
  });
});
