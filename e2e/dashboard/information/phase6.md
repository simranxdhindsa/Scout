# Phase 6 — Test Analytics

## Overview

Adds a read-only **Analytics** page (`/dashboard/analytics`) that surfaces quality metrics derived from historical run data.  No new DB tables — queries run over existing `run_items`, `test_runs`, `test_cases`, `test_folders`, `sub_projects`, and `products` tables.

---

## Features

| Feature | Description |
|---|---|
| Overview cards | Total test cases, run count (7d), avg pass rate (7d), avg duration (7d), flaky count (30d), slow test count |
| Flaky tests table | Tests with mixed pass/fail results: ≥3 runs in last 30 days, at least 1 pass AND 1 fail; sorted by "most 50/50" first |
| Slow tests table | Tests ranked by avg duration (p95 also shown); ≥2 runs with `duration_ms > 0` in last 30 days |
| Per-test history panel | Click any row in either table → inline sparkline of last N run results (newest→oldest), colour-coded by status |

---

## API Endpoints

All require org-member auth (`RequireOrgMember` middleware).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/orgs/{orgId}/analytics/overview` | Aggregate health metrics |
| `GET` | `/api/v1/orgs/{orgId}/analytics/flaky?limit=20` | Flaky test list |
| `GET` | `/api/v1/orgs/{orgId}/analytics/slow?limit=20` | Slow test list |
| `GET` | `/api/v1/orgs/{orgId}/analytics/tests/{testCaseId}/history?limit=30` | Per-test run history |

### Response shapes

**overview**
```json
{
  "total_test_cases": 22,
  "runs_last_7d": 145,
  "avg_pass_rate_7d": 87.3,
  "avg_duration_ms": 4200,
  "flaky_count": 3,
  "total_runs_last_7d": 20
}
```

**flaky_tests**
```json
{
  "flaky_tests": [{
    "test_case_id": "...",
    "test_name": "...",
    "file_name": "...",
    "folder_name": "...",
    "sub_project_name": "...",
    "total_runs": 12,
    "passed_count": 7,
    "failed_count": 5,
    "pass_rate": 58.3,
    "last_run_at": "2026-06-01T..."
  }]
}
```

**slow_tests**
```json
{
  "slow_tests": [{
    "test_case_id": "...",
    "test_name": "...",
    "file_name": "...",
    "folder_name": "...",
    "sub_project_name": "...",
    "run_count": 8,
    "avg_duration_ms": 18500,
    "max_duration_ms": 24000,
    "p95_duration_ms": 22100
  }]
}
```

**history**
```json
{
  "history": [{
    "run_id": "...",
    "status": "passed",
    "duration_ms": 4200,
    "run_at": "2026-06-01T..."
  }]
}
```

---

## Backend Implementation

### Files

| File | Purpose |
|---|---|
| `internal/db/queries/analytics.go` | `AnalyticsQueries` struct with `GetOverview`, `GetFlakyTests`, `GetSlowTests`, `GetTestHistory` |
| `internal/api/analytics.go` | HTTP handlers: `Overview`, `FlakyTests`, `SlowTests`, `TestHistory` |
| `internal/api/router.go` | 4 routes registered under `RequireOrgMember` |

### Important schema note

`sub_projects` has no `org_id` column — it links to `products.id`, and `products.org_id` is the org anchor.  All queries join `sub_projects → products` before filtering by `p.org_id = $1`.

### SQL highlights

- **Flaky sort**: `LEAST(passed, failed) / total DESC` — closest to 50/50 appears first (most unreliable).
- **Slow p95**: `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ri.duration_ms)::INT` — PostgreSQL ordered-set aggregate, requires ≥2 data points.
- **Overview flaky count**: inline subquery counts distinct `tc.id` that satisfy the same HAVING conditions as `GetFlakyTests`.

---

## Frontend Implementation

| File | Purpose |
|---|---|
| `src/pages/analytics.tsx` | Main Analytics page — overview cards + flaky/slow tables + inline history sparkline |
| `src/lib/scout-api.ts` | `analyticsApi` typed wrappers + types (`AnalyticsOverview`, `FlakyTest`, `SlowTest`, `TestRunHistoryEntry`) |
| `src/router.tsx` | Route `analytics` under `/dashboard` |
| `src/components/app-sidebar.tsx` | Analytics nav item (BarChart2Icon) |
| `src/pages/dashboard-layout.tsx` | Breadcrumb entry `"/dashboard/analytics": "Analytics"` |

### UI patterns

- Six overview metric cards in a responsive grid (2 cols → 3 cols → 6 cols).
- Flaky and slow tables are side-by-side on xl screens, stacked below.
- Click a row to toggle an inline history panel showing `StatusDot` squares newest-first.
- Same `activeTestId` is shared between both tables — only one panel open at a time.
- Empty states: green checkmark for "no flaky tests", clock icon for "no timing data yet".

---

## QA Fixes Applied During This Phase

| Issue | Fix |
|---|---|
| `sp.org_id` column does not exist | All queries joined `sub_projects → products` and filter on `p.org_id` instead |
| Flaky/slow endpoints returned 500 | Fixed by the above join correction |
