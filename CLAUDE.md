## Project Overview

This repo is **Scout** — a Playwright e2e test suite and management platform for the **Ardoise** e-learning product family (UI/student platform, Mission Control/admin CMS, Studio-Web/authoring tool).

```
test-cases/
├── e2e/
│   ├── specs/           Playwright test specs (ui/, mission-control/, studio-web/, recorded/)
│   ├── pages/           Page Object Models (POM) per product
│   ├── fixtures/        Playwright fixtures (auth, mocks, accessibility, network logger)
│   ├── utils/           Shared helpers (api-helpers, test-data, wait-helpers)
│   ├── dashboard/       Scout dashboard app (Go backend + Vite/React frontend)
│   │   ├── backend/     Go API server — port 8080
│   │   └── frontend/    Vite + React 19 SPA — dev port 5173
│   ├── docs/            Internal docs
│   ├── scripts/         Helper scripts (e.g. save-report.js)
│   ├── .auth/           Saved auth state (mc-user.json, ui-user.json, sw-user.json)
│   ├── reports/         HTML + JSON test reports (+ timestamped run archives)
│   ├── snapshots/       Visual regression baselines
│   └── playwright.config.ts
├── scorm_scraper/       Go tool for SCORM scraping
└── package.json         Monorepo root — all npm scripts here
```

---

## Core Product Principle — Dashboard is the Only Interface

**The custom dashboard (`e2e/dashboard/`) is the single interface for ALL operations.**
Non-technical users must be able to do everything from `http://localhost:3000` — no terminal, no CLI.

This applies to:
- Running tests (all products, individual suites, single specs)
- Recording new tests (codegen — opens browser automatically)
- Viewing results and reports
- Managing auth sessions (check status, re-authenticate)
- Anything else added in the future

**Never** suggest the user run `npm run`, `npx playwright`, `go run`, or any shell command
to accomplish a task the dashboard could handle. When building new features, always pair
the backend endpoint with a dashboard UI control in the same change.

---

## npm Scripts (root `package.json`)

| Script | Purpose |
|--------|---------|
| `dev` / `pw:dashboard` | Start both Go backend + Vite frontend concurrently |
| `pw:dashboard:backend` | Go backend only (`go run ./cmd/server/main.go`) — port 8080 |
| `pw:dashboard:frontend` | Vite frontend only (`npm run dev`) — port 5173 |
| `pw:dashboard:build` | Install + production build of the frontend (`tsc -b && vite build`) |
| `pw:test` | Run all Playwright specs + save report |
| `pw:test:ui` | Run `ui` project only |
| `pw:test:mc` | Run `mission-control` project only |
| `pw:test:sw` | Run `studio-web` project only |
| `pw:test:headed` / `pw:test:debug` / `pw:ui` | Headed / debug / Playwright UI mode |
| `pw:report` | Open HTML report at `e2e/reports/html` |
| `pw:codegen:ui/mc/sw` | Codegen for each product (auto-loads auth state) |
| `pw:update-snapshots` | Refresh visual regression baselines |
| `pw:install` | Install Chromium for Playwright |

---

## Playwright Projects

Three test projects, each scoped to one Ardoise product. URLs come from `.env.e2e`.

| Project | Spec path | Auth state |
|---------|-----------|-----------|
| `ui` | `specs/ui/` | `e2e/.auth/ui-user.json` (bearer JWT) |
| `mission-control` | `specs/mission-control/` | `e2e/.auth/mc-user.json` (Google SSO / NextAuth) |
| `studio-web` | `specs/studio-web/` | `e2e/.auth/sw-user.json` (bearer JWT) |

`-no-auth` variants exist for each product (auth specs run without pre-loaded state).

---

## Dashboard Architecture

### Backend (`e2e/dashboard/backend/` — Go, module `github.com/apyhub/scout`)

See `e2e/dashboard/backend/CLAUDE.md` for the in-depth backend guide (startup sequence, handler/middleware patterns, `chain()`, JSON helpers, migrations, auth context, storage abstraction).

- **Port**: 8080
- **DB**: PostgreSQL (NeonDB); auto-migrates on startup via embedded SQL in `internal/db/migrations/`
- **Auth**: Google OAuth → JWT; platform-admin role seeded from `PLATFORM_ADMIN_EMAILS`
- **Storage**: local (`./data`) or S3, swapped via `STORAGE_DRIVER`
- **Key packages**:
  - `internal/api/` — all HTTP handlers + router (`router.go`)
  - `internal/runner/` — queued Playwright test execution, live WebSocket streaming
  - `internal/scorm/` — SCORM upload, generation, Phoenix poller
  - `internal/ai/` — Groq LLM, RAG/vector store, test generator, run analyzer
  - `internal/notifications/` — in-app notification service
  - `internal/gitlab/` — GitLab OAuth + repo/dir sync for importing specs from GitLab projects
  - `internal/youtrack/` — YouTrack integration: sprint/issue fetch + test-case mappings
  - `internal/slack/` — Slack incoming-webhook run notifications
  - `internal/scheduler/` — cron-based scheduled test runs

### Frontend (`e2e/dashboard/frontend/` — Vite + React 19 + TypeScript)

See `e2e/dashboard/frontend/CLAUDE.md` for the in-depth frontend guide (theming, shadcn/ui, axios client, auth store, polling/dialog patterns, TS config gotchas).

- **Dev port**: 5173 (Vite default)
- **Stack**: React 19, react-router-dom v7, Tailwind v4 via `@tailwindcss/vite`, shadcn/ui (style `radix-sera`, base color `neutral`), Zustand, Axios, Radix UI, lucide-react
- **Entry**: `src/main.tsx` → `ThemeProvider` → `TooltipProvider` → `AuthBootstrap` → `<RouterProvider />`. Routes defined in `src/router.tsx` via `createBrowserRouter`.
- **Auth**: Google OAuth full-page redirect (`GET /api/v1/auth/google`) → `/auth/callback?token=…`. JWT stored in the `scout_token` **cookie** (path `/`, `SameSite=Lax`, 7-day expiry, `Secure` on HTTPS) — *not* `localStorage`. Helpers in `src/lib/auth.ts`; auth state in the Zustand `useAuthStore`. Route guards `RequireAuth` / `RedirectIfAuthed` live in `src/components/require-auth.tsx`.
- **Routes** (flat, not org-slug scoped):
  - `/login`, `/auth/callback`
  - `/` — home
  - `/dashboard` (inside `DashboardLayout`) — index, `runs`, `pipeline` (+ `pipeline/runs/:flowRunId`), `sprints`, `ai-assistant`, `analytics`, `settings/{environments,members,archive-queue,ai-config,integrations,organisations,scheduled-runs}`
  - `/projects` — list; `/projects/:slug` — project detail
  - `/runs/:runId` — live run output + report
- **Layout**: `src/pages/dashboard-layout.tsx` owns sidebar + header (`SidebarTrigger`, breadcrumb resolved from `pathname` via `resolveTitle`, `<NotificationsBell />`, `<ModeToggle />`). Sidebar nav is a static `data` blob in `src/components/app-sidebar.tsx`.
- **API layer**: single axios client `src/lib/api.ts` (baseURL `${VITE_SCOUT_API_URL || http://localhost:8080}/api/v1`, bearer interceptor, 401 → clears cookie + redirects `/login`). Typed wrappers per backend area in `src/lib/scout-api.ts` (`authApi`, `orgsApi`, `productsApi`, `subProjectsApi`, `foldersApi`, `testsApi`, `runsApi`, `pipelinesApi`, `flowsApi`, `overviewApi`, `analyticsApi`, `environmentsApi`, `membersApi`, `adminUsersApi`, `adminOrgMembersApi`, `archiveApi`, `aiConfigApi`, `chatHistoryApi`, `notificationsApi`, `gitlabApi`, `youtrackApi`, `slackApi`, `scheduledRunsApi`, plus the `streamChat` SSE helper). Add new endpoints as typed wrappers there, not inline.
- **Path alias**: `@/* → ./src/*` configured in `tsconfig.json`, `tsconfig.app.json`, and `vite.config.ts` — keep all three in sync.

### Backend API (base `/api/v1/`)

Auth: `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /auth/me`  
Orgs: `GET/POST /admin/orgs`, `GET /orgs`, `GET /orgs/{orgId}`  
Members: `GET/POST/PUT/DELETE /orgs/{orgId}/members/{memberId}`  
Products: `GET/POST/PUT/DELETE /orgs/{orgId}/products/{productId}`  
Sub-projects: `GET/POST/PUT/DELETE /orgs/{orgId}/products/{productId}/subprojects/{spId}`  
Environments: `GET/POST/PUT/DELETE /orgs/{orgId}/environments/{envId}`; env-URLs on sub-project  
Folders: `GET/POST /subprojects/{spId}/folders`; `PUT/DELETE /folders/{folderId}`  
Tests: `GET/POST /folders/{folderId}/tests`; `GET/PUT/versions/validate/archive-request` on `/tests/{testId}`  
Runs: `POST/GET /orgs/{orgId}/runs`; `GET/DELETE /orgs/{orgId}/runs/{runId}`; `GET /runs/{runId}/stream` (WebSocket)  
Reports: `GET /orgs/{orgId}/reports`; `GET /orgs/{orgId}/reports/stats`; `GET /runs/{runId}/report`  
Pipelines: `GET/POST /orgs/{orgId}/pipelines`; `PUT/DELETE/run` on `/{pipelineId}`  
Archive queue: `GET/approve/reject` under `/orgs/{orgId}/archive-queue`  
AI: `GET/PUT /orgs/{orgId}/ai/config`; `POST /ai/chat`, `/ai/analyze/{runId}`, `/ai/generate-test`; chat sessions `GET/POST /ai/sessions`, `PUT/DELETE /ai/sessions/{sessionId}`  
Notifications: `GET/read-all/read` under `/me/notifications`  
SCORM: upload, status, snapshots, generators under `/orgs/{orgId}/scorm/`  
GitLab: `GET /auth/gitlab/callback`; `GET /orgs/{orgId}/integrations/gitlab` (list); `GET .../connect` (OAuth init); `GET .../{integrationId}/repos|dirs`; `PUT/DELETE /{integrationId}`; `POST /{integrationId}/sync`  
YouTrack: `GET/POST/DELETE /orgs/{orgId}/integrations/youtrack`; `GET .../{integrationId}/boards|sprints`; `GET .../sprints/{sprintId}/issues`; `POST .../sprints/{sprintId}/run`; `GET/POST/DELETE /orgs/{orgId}/youtrack/mappings`  
Slack: `GET/PUT /orgs/{orgId}/settings/slack`  
Scheduled runs: `GET/POST /orgs/{orgId}/scheduled-runs`; `PUT/DELETE /{schedId}`; `POST /{schedId}/toggle`  
Analytics: `GET /orgs/{orgId}/analytics/{overview,flaky,slow}`; `GET /orgs/{orgId}/analytics/tests/{testCaseId}/history`

---

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
