<!--
  Documents: Cross-Platform Flows feature (Phase 3)
  Files: internal/db/migrations/010_flows.sql, internal/db/queries/flows.go,
         internal/api/flows.go, internal/runner/flow_runner.go,
         frontend/src/pages/flows.tsx
-->

# Flows — Cross-Platform Test Chains

## What it is

A **Flow** is an ordered sequence of test steps that execute sequentially across
the three Ardoise products (ui / mission-control / studio-web). Each step is a
regular Scout test run. Steps can pass data to later steps via a **shared state**
map (env-var key-value pairs), enabling true end-to-end coverage across product
boundaries (e.g. "create course in Studio → publish in Mission Control → verify
in UI").

---

## Database tables (migration 010)

| Table | Purpose |
|---|---|
| `flows` | Named flow definition per org. `is_template` flag reserved for future use. |
| `flow_steps` | Ordered steps within a flow. `position` is unique per flow. Each step points to either a `test_case_id` OR a `folder_id` (or neither, as a placeholder). |
| `flow_runs` | A single execution of a flow. Carries `shared_state JSONB` that accumulates across steps. Status: `queued→running→passed/failed/stopped`. |
| `flow_step_runs` | Per-step execution record inside a `flow_run`. Links to the underlying `test_runs.id` via `run_id`. Status: `pending→running→passed/failed/skipped`. |

### Shared-state passing

`flow_steps.env_inputs` — JSONB array of `{"key": "COURSE_ID", "from": "SHARED_COURSE_ID"}`:
the runner injects shared-state values as env vars before executing the step.

`flow_steps.env_outputs` — JSONB array of `{"from": "OUTPUT_COURSE_ID", "to": "SHARED_COURSE_ID"}`:
after a step runs, the runner scans stdout for lines matching `SCOUT_OUTPUT_<KEY>=<value>`
and writes matches into `flow_runs.shared_state`.

`flow_runs.shared_state` is persisted after every step so a mid-run failure
does not lose already-extracted state.

---

## Backend

### Queries — `internal/db/queries/flows.go`

`FlowQueries` struct wraps all DB access. Key points:
- `ListByOrg` includes a `COUNT(step_count)` join — the list endpoint returns this.
- `ReorderSteps` uses a two-pass transaction with a large offset (`+10000`) to
  avoid the `UNIQUE(flow_id, position)` constraint firing mid-update.
- `UpdateRunStatus` auto-sets `started_at`/`finished_at` in SQL based on status value.

### API — `internal/api/flows.go`

`flowHandler` — all routes require `Authenticate + RequireOrgMember`.

| Route | Handler |
|---|---|
| `GET /api/v1/orgs/{orgId}/flows` | `List` — returns flows with step_count |
| `POST /api/v1/orgs/{orgId}/flows` | `Create` |
| `GET /api/v1/orgs/{orgId}/flows/{flowId}` | `Get` — returns flow + steps array |
| `PUT /api/v1/orgs/{orgId}/flows/{flowId}` | `Update` |
| `DELETE /api/v1/orgs/{orgId}/flows/{flowId}` | `Delete` |
| `POST /api/v1/orgs/{orgId}/flows/{flowId}/run` | `RunFlow` — creates flow_run + enqueues |
| `GET /api/v1/orgs/{orgId}/flows/runs` | `ListRuns` (paginated: limit/offset) |
| `GET /api/v1/orgs/{orgId}/flows/runs/{flowRunId}` | `GetRun` — returns flow_run + step_runs |
| `POST/PUT/DELETE .../steps[/{stepId}]` | `AddStep` / `UpdateStep` / `DeleteStep` |
| `POST .../steps/reorder` | `ReorderSteps` — body: `{step_ids: [uuid...]}` |

**Route ordering gotcha**: `/flows/runs` must be registered before `/flows/{flowId}` in the
mux or the Go pattern router will match `runs` as a `flowId`. The router already does this.

### Runner — `internal/runner/flow_runner.go`

`EnqueueFlow` wraps a `FlowRunJob` as a `RunJob{IsFlow: true}` — it reuses the
same worker queue as regular runs.

`processFlowRun` is the core loop:
1. Mark flow_run as `running`.
2. Load ordered steps.
3. For each step: create `flow_step_run`, inject `env_inputs` from shared state,
   call `executeStepAsRun` (creates a real `test_runs` row, runs Playwright, streams output).
4. On step pass: extract `SCOUT_OUTPUT_*` vars from stdout → merge into shared state → persist.
5. On step fail: mark flow_run `failed`, send org notification, abort.
6. All steps passed: mark `passed`, send notification.

`executeStepAsRun` reuses the full workspace + config generation + `npx playwright test`
machinery identical to normal runs. The step's extra env vars are appended to `os.Environ()`.

---

## Frontend — `src/pages/flows.tsx`

Route: `/dashboard/pipeline` (the "Pipeline" sidebar tab was replaced by this page).

**Components:**
- `FlowsPage` — top-level, has "Flows" / "Runs" tab switcher.
- `FlowCard` — collapsible card per flow. Lazy-loads steps on expand. Run button
  calls `flowsApi.run()` and navigates to `/dashboard/pipeline/runs/{flowRunId}`.
- `CreateFlowDialog` — name + description form.
- `AddStepDialog` — name + product selector (no test_case mapping in UI yet; that's done via API).
- `FlowRunsTable` — polls every 5 seconds for live status updates.

**API client** — all calls via `flowsApi` in `src/lib/scout-api.ts`.

---

## Invariants and gotchas

- A flow step with neither `test_case_id` nor `folder_id` is **skipped** (not failed) during execution.
- Flow runs appear as regular `test_runs` on the Runs page (labelled `[Flow] <step name>`).
- Shared state keys are case-sensitive strings; stdout extraction prefix is `SCOUT_OUTPUT_` + uppercased key.
- Deleting a flow cascades to steps and runs. Deleting a test_case sets `flow_steps.test_case_id = NULL`
  (ON DELETE SET NULL), which will cause that step to be skipped on next run.
- `is_template` is stored but not currently used by the runner or UI.
