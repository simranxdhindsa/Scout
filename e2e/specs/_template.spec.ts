/**
 * SPEC TEMPLATE — copy this file to create a new test.
 *
 * Workflow:
 *   1. Run `npm run pw:codegen:ui` (or :mc / :sw) to record a flow
 *   2. Tell Claude: "add assertion for X, use CoursesPage POM, check accessibility"
 *   3. Claude refines the recorded code into a clean spec like this one
 *   4. Move final file to the right folder: e2e/specs/[product]/[feature]/[name].spec.ts
 *
 * Import paths — adjust based on where this file lives in specs/:
 *   From specs/ui/courses/ → ../../fixtures  and  ../../pages/ui/courses.page
 *   From specs/mission-control/courses/ → ../../fixtures  and  ../../pages/mission-control/...
 */

import { test, expect } from '../../fixtures';

// Uncomment the POM you need:
// import { CoursesPage }      from '../../pages/ui/courses.page';
// import { DashboardPage }    from '../../pages/ui/dashboard.page';
// import { CourseCreatePage } from '../../pages/mission-control/course-create.page';
// import { ProjectsListPage } from '../../pages/studio-web/projects-list.page';

test.describe('[Feature: describe what this group tests]', () => {

  test('[what this specific test verifies]', async ({ page, a11y }) => {

    // --- NAVIGATION ---
    // const courses = new CoursesPage(page);
    // await courses.goto();

    // --- ACTIONS (paste recorded codegen output here, then refine) ---
    // await page.getByRole('button', { name: 'Courses' }).click();
    // await page.getByText('My Course').click();

    // --- ASSERTIONS ---
    // await expect(page.getByRole('heading')).toBeVisible();
    // await expect(page).toHaveURL(/\/courses/);

    // --- ACCESSIBILITY (optional but recommended) ---
    // await a11y.assertNoViolations();
  });

});
