# tests/studio-web — author/debug playbook

Everything below is hard-won from making this suite pass against the deployed studio-web app. Apply on every new spec — most of these were one-off lessons that cost a full diagnostic cycle to find.

## Spec URL — must match the file route, including trailing segment

studio-web routes are mounted under Next `basePath: '/studio'`. The page file path on disk determines the URL.

- `pages/project/[uuid]/section/[sectionId]/asset/[assetId]/details/index.tsx` → `/studio/project/<uuid>/section/<sid>/asset/<aid>/details` (the trailing `/details` is **required** — the file lives in a `details/` subdir)
- Hex/UUID format of the ID segments does **not** matter. `project-foo-uuid` works. The deployed app does not validate the format.

If a spec navigates to an URL that doesn't match a page file, you get studio-web's own 404 page (`"Oops Page Not Found! (404)"` rendered inside the studio shell). Symptom is identical to the hydration-crash case below — disambiguate by checking `curl -sI <url>` returns 200 (page exists) vs. 404.

## The mock-shape rule (the dominant failure mode)

studio-web's child components dereference many fields you don't see being read in the page file itself. A lean `buildCourseDetails` like `{ uuid, name, sections, status: { key }, mode: { key }, ... }` will load, render briefly, then crash to studio-web's 404 page when a child component throws. **It looks identical to a real 404.** This is not a deployment problem; it's the mock.

Always return the full real-shape from `/o/course/projects/<uuid>`. Required fields, with real-shape values:

```ts
data: {
  uuid, name,
  owner: { uuid, name, domain, ardoise_id },        // domain must match BASE_URL subdomain for tabs / actions
  mode:   { uuid, key, type: 'project-mode', order },
  status: { uuid, key, type: 'status', order },
  under_review: false,
  title, description, objectives, target_audience, prerequisites,
  type:   { uuid, key, type: 'course-type', order },
  project_language: { uuid, key, type: 'asset-languages-type', order },
  additional_languages: [],                          // NOT `languages` — real backend uses `additional_languages`
  level, teaser,
  created_by, updated_by, created_at, updated_at,
  scorm_scrapped: false, setup_complete: true, setup_incomplete_for: [],
  source_project_id: null, source_org: null, published_course_id: null,
  knowledge_bases: [], kb_slots: [], topics: [], sections: [], skills: [], roles: [],
  description_translations: [], objective_translations: [],
  target_audience_translation: [], prerequisites_translations: [], project_title_translation: [],
}
```

`buildSection`: needs `uuid, name, order, application: null, section_name_translations: [], assets: [...]`.
`buildAsset` (in-section or asset-details): needs `uuid, name, order, estimated_duration, description, type, settings: { ai_delivered, visual_assistance }, instructions: null, resources: [], asset_name_translations: []`.

Diagnosis: if the page snapshot shows studio's nav rendered around an "Oops Page Not Found" main, **the mock is the suspect, not the URL**. Confirm by mocking with the *real* response body (`curl` with the auth cookie) — if that renders, your enrichment is incomplete.

## Mock route order — Playwright is LIFO

`page.route` handlers match in reverse-registration order. Last registered wins. So:

- **catch-all first**, specific mocks **last**. Always.
- The pattern `await mockCatchAllApi(page); await mockUserProfile(page); await mockCourseDetails(page); await mock<Specific>(page);` is correct.
- The inverse — what most spec authors instinctively write — silently overrides the specific mocks with empty `{ data: [] }` and turns into the mock-shape failure above.

`setupPage()` already does this correctly. The trap is in tests that build their own mock chain (delete flows, post flows, 500-edge cases) — those forget catch-all should be first.

## Breadcrumb truncates at 16 chars

`components/breadcrumb/breadcrumb.tsx` truncates to 16 chars (returns `"My Long Project..."` for anything longer). `getByText(COURSE_NAME, { exact: true })` will fail because the rendered text isn't the literal `COURSE_NAME`.

Rule: keep `COURSE_NAME` ≤ 16 chars. Use names like `'My Section'`, `'My Topics'`, `'My SC Project'` (13). Section/asset names that appear in breadcrumbs should follow the same rule.

## Course-name / section-name strict-mode violations

Course name often renders 2–3 times on a page: breadcrumb, sidebar nav (SecondaryLayout), and inline (e.g. "Project Name: …" on overview). Section names render in sidebar nav *and* in main. Always scope, or `.first()`:

```ts
// Breadcrumb-only assertion, when course name also renders inline in main:
await expect(page.getByText(COURSE_NAME, { exact: true }).first()).toBeVisible();

// Section/asset names inside main only (sidebar nav also shows them):
await expect(page.getByRole('main').getByText(SECTION_NAME, { exact: true }).first()).toBeVisible();
```

`getByRole('alert')` has the same problem — the app has toast/cookie alert containers outside `<main>`. Scope to `getByRole('main').getByRole('alert')` for in-content alerts.

## 500-error edge cases — react-query retries outlast the 10s timeout

react-query default config retries 3× with exponential backoff (~7s). Tests that assert "page still renders after API 500" almost always time out because `isLoading` stays true through the retries.

Pattern that works: assert the **error toast** that the page shows instead. The error message format is `"Request failed with status code 500"` (verbatim, from axios). One assertion replaces the brittle "page renders eventually" check:

```ts
await expect(
  page.getByText(/Request failed with status code 500/i).first()
).toBeVisible({ timeout: 15000 });
```

Rename the test from `"keeps the page usable when X endpoint fails"` to `"surfaces an error toast when X endpoint fails"`.

## Section-detail-specific: `<Assets>` auto-opens add-topic when section is empty

`features/courses/asset/index.tsx` has this effect:

```ts
useEffect(() => {
  if (sectionDetails?.assets?.length === 0 && !isDisabled) setShowAddTopic(true);
}, [details]);
```

That auto-opens the add-topic flow ~1s after data loads, displacing the title row. The delete `ActionIcon` *detaches* mid-click, so `titleRow.locator('button').click()` times out with `"element was detached from the DOM, retrying"`.

Fix: seed the section with a placeholder asset by default in `buildSection`. Tests that explicitly want an empty section can still override `assets: []` in their builder call — but the default should be one asset.

## Authentication / storage state

`global-setup.ts` logs in once and writes `playwright/.auth/user.json`. studio-web's middleware (`src/middleware.ts`) checks for `accessToken` / NextAuth session cookies and 307s to `/auth/signIn` if absent. The auth-redirect test must opt out with `browser.newContext({ storageState: undefined })`.

## Things that look broken but are not

- **React error #418 / #423 hydration warnings** in the console: benign. Studio-web SSRs a loader shell, client hydrates with real or mocked data, React logs a hydration mismatch. The page still renders correctly once these recover. Don't try to fix them.
- **Cookie-banner / toast-region `<alert>` nodes** at the bottom of every snapshot: app-wide chrome, ignore them; scope your alert assertions to `<main>`.
- **`progressbar "Loading page /project/..."`** in the snapshot: Next router's accessibility announcement during client-side nav. It persists briefly even after the page is interactive. Not a real loader.

## Quick failure-mode triage

| Symptom | Most likely cause |
|---|---|
| "Oops Page Not Found! (404)" in `<main>` + studio nav around it | Lean mock shape — enrich `buildCourseDetails` |
| Strict-mode violation on `getByText(NAME)` resolving to 2+ elements | Name appears in sidebar nav + main; scope with `getByRole('main').…first()` |
| Element detached from DOM during click | `<Assets>` auto-opening add-topic; seed section with a placeholder asset |
| `getByRole('heading', /overview/)` never visible after 10s on a 500-error edge case | react-query retries; reframe as toast assertion |
| Course name not found even after enrichment | >16 chars; breadcrumb truncated it — shorten the constant |
| Specific mock not firing, gets empty `{ data: [] }` instead | Catch-all registered after specific mock; reorder catch-all to top |
| All render tests fail, only auth + `waitForRequest` pass | First check URL matches the on-disk page file (incl. trailing `/details`, `/context`, etc.) |
