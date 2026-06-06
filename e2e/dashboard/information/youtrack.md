<!--
  Documents: YouTrack Sprint Testing Integration (Phase 4)
  Files: internal/db/migrations/011_utrack.sql, internal/youtrack/client.go,
         internal/youtrack/service.go, internal/api/youtrack.go,
         frontend/src/pages/sprints.tsx
-->

# YouTrack Sprint Testing Integration

## What it is

Connects a Scout org to a YouTrack instance via a **permanent token**. Once
connected, users can browse sprints, see which issues are in a sprint, map
YouTrack tickets to Scout test cases (many-to-many), and fire a Scout test run
for all test cases mapped to a sprint's tickets in one click.

---

## Database tables (migration 011)

| Table | Purpose |
|---|---|
| `youtrack_integrations` | One row per `(org_id, user_id)` pair — integrations are per-user within an org. Stores `base_url`, `token` (plaintext), `project_id`, `board_id`, `connected`. UPSERT on duplicate. |
| `youtrack_ticket_mappings` | Links a `ticket_id` (readable key e.g. `ARD-42`) to a `test_case_id`. Unique on `(org_id, ticket_id, test_case_id)`. One ticket can map to many tests; one test can appear in many tickets. |

**Security note**: the YouTrack permanent token is stored as plaintext in the DB.
Do not log it; do not return it from the `GetStatus` / `GetByID` endpoints (they
intentionally omit `token` from the SELECT).

---

## Backend

### Client — `internal/youtrack/client.go`

`Client` wraps the YouTrack REST API v1. All requests use `Authorization: Bearer <token>`.
Timeout is 20 s.

Key methods:
- `TestConnection` — calls `/api/users/me` to validate credentials on connect.
- `GetBoards` — lists all agile boards accessible to the token.
- `GetSprints` — returns sprints for the configured board (up to 50).
- `GetSprintIssues` — fetches up to 200 issues for a sprint with custom fields.
- `SearchIssues` — YQL query search (unused in UI currently; available for future use).
- `resolveBoard` — if `boardID` is empty, auto-detects the first sprint-enabled board
  whose projects list includes `projectID` (case-insensitive match on `shortName`).

Custom field helpers (`GetStatus`, `GetPriority`, `GetSubsystem`) extract named
custom fields from `issue.CustomFields[]` by iterating and checking `f.Name`.
Values can be a string or a map with `name`/`presentation` key.

### Service — `internal/youtrack/service.go`

`Service` owns all DB operations. Notable:
- `Connect` uses `INSERT ... ON CONFLICT DO UPDATE` — calling Connect again with
  new credentials silently replaces the old integration for that `(org_id, user_id)`.
- `GetClient(integrationID)` loads credentials from DB and returns a ready `*Client`.
  Used by all sprint/board API handlers so they never hold client state in memory.
- `GetMappedTestCaseIDs` returns `DISTINCT test_case_id` for a list of ticket IDs —
  used by `RunSprint` to collect the test set.
- `ListMappings` does a LEFT JOIN to `test_cases` to populate `test_case_name`.

### API — `internal/api/youtrack.go`

`youtrackHandler` — all routes require `Authenticate + RequireOrgMember`.

| Route | Handler | Notes |
|---|---|---|
| `POST /orgs/{orgId}/integrations/youtrack` | `Connect` | Validates token before saving |
| `GET /orgs/{orgId}/integrations/youtrack` | `GetStatus` | Returns `{connected: false}` if not found |
| `DELETE /orgs/{orgId}/integrations/youtrack/{integrationId}` | `Disconnect` | Verifies org ownership first |
| `GET .../youtrack/{integrationId}/boards` | `GetBoards` | Proxies YouTrack API |
| `GET .../youtrack/{integrationId}/sprints` | `GetSprints` | Proxies YouTrack API |
| `GET .../youtrack/{integrationId}/sprints/{sprintId}/issues` | `GetSprintIssues` | Annotates each issue with its `mappings` array |
| `POST .../youtrack/{integrationId}/sprints/{sprintId}/run` | `RunSprint` | Creates run + enqueues |
| `GET /orgs/{orgId}/youtrack/mappings` | `ListMappings` | Org-wide mapping list |
| `POST /orgs/{orgId}/youtrack/mappings` | `CreateMapping` | |
| `DELETE /orgs/{orgId}/youtrack/mappings/{mappingId}` | `DeleteMapping` | |

`GetSprintIssues` augments the YouTrack response: it loads all org mappings,
groups them by ticket key, and injects a `mappings []TicketMapping` field plus
`status`, `priority`, `subsystem` strings (extracted from custom fields) onto
each issue row. This avoids a separate API call from the frontend per issue.

`RunSprint` flow:
1. Fetch sprint issues → collect ticket IDs.
2. `GetMappedTestCaseIDs(orgID, ticketIDs)` → error 422 if none mapped.
3. Create a `test_runs` record (label defaults to `"Sprint run"`).
4. Insert `run_items` for each test case.
5. Enqueue via `Runner.Enqueue`.
6. Return `{run_id, status: "queued", tests: N}`.

---

## Frontend — `src/pages/sprints.tsx`

Route: `/dashboard/sprints` (Sprints entry in sidebar).

**States:**
- `integration === undefined` — loading skeleton.
- `integration === null` — not connected; shows `ConnectForm`.
- `integration` present — shows sprint list.

**Components:**
- `ConnectForm` — fields: Instance URL, Permanent Token, Project ID, Board ID (optional).
  On connect: calls `youtrackApi.connect()` which validates the token server-side before saving.
- `SprintCard` — collapsible. Lazy-loads issues on first expand. Header shows
  covered/total issue counts and total mapped tests. Run button disabled if `totalMapped === 0`.
- `IssueRow` — shows ticket key, summary, status badge, priority dot, subsystem label,
  existing mappings as removable chips, plus a `+` button to open `MapTestDialog`.
- `MapTestDialog` — takes a test case UUID (raw input). Future improvement: replace with
  a searchable test case picker.

Active sprints sort before completed sprints (client-side sort on `isCompleted`).

---

## Invariants and gotchas

- Integrations are **per-user per org** (`UNIQUE(org_id, user_id)`). Two members of the
  same org each have their own YouTrack connection (their own token/project scope).
  `GetStatus` checks by `(org_id, user_id)` from JWT claims, not just `org_id`.
- `boardID` is optional. If left blank, `resolveBoard` auto-detects by matching
  `projectID` against board project lists — falls back to the first sprint-enabled board.
- Sprint issues are fetched with `$top=200`. YouTrack paginates at higher counts;
  if a sprint has >200 issues this will silently truncate.
- The token is stored in plain text. Do not surface it in API responses (the `Connect`
  INSERT returns the row without the `token` column by design).
- `RunSprint` reuses the standard runner queue — the resulting run is visible on the
  Runs page with the label provided in the request body (or `"Sprint run"` as default).
