<!--
  Documents: Dashboard Core — Go backend + React frontend foundation
  Files: backend/cmd/server/main.go, backend/internal/api/router.go,
         backend/internal/db/migrations/001_init.sql,
         frontend/src/main.tsx, frontend/src/router.tsx,
         frontend/src/lib/api.ts, frontend/src/lib/scout-api.ts
-->

# Dashboard Core

## What it is

Scout's dashboard is a **Go HTTP API** (port 8080) backed by **PostgreSQL
(NeonDB)** and a **Vite + React 19** SPA (dev port 5173). It is the single
interface for running tests, viewing reports, managing auth sessions, and
administering the platform. Non-technical users must never need a terminal.

---

## Backend

### Startup sequence (`cmd/server/main.go`)

1. Load config from env (`config.Load`).
2. Connect PostgreSQL pool (`db.Connect`).
3. Run embedded SQL migrations (`db.RunMigrations`) — idempotent, runs on every start.
4. Seed platform admins from `PLATFORM_ADMIN_EMAILS`.
5. Init storage (local `./data` or S3 via `STORAGE_DRIVER`).
6. Init notification, AI (Groq + RAG), runner, SCORM, auth, GitLab, YouTrack services.
7. Start runner workers (configurable concurrency via `MAX_CONCURRENT_RUNS`).
8. Register all HTTP routes (`api.RegisterRoutes`).
9. Listen with 30 s read / 120 s write timeouts and graceful shutdown on SIGINT/SIGTERM.

### Config env vars (key subset)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs Scout JWT tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated emails seeded as platform admins |
| `STORAGE_DRIVER` | `local` (default) or `s3` |
| `MAX_CONCURRENT_RUNS` | Playwright worker concurrency |
| `GROQ_API_KEY` | AI / LLM features |
| `PORT` | Defaults to `8080` |

### Database schema (migration 001 — core tables)

| Table | Purpose |
|---|---|
| `users` | Google SSO users |
| `organizations` | Tenants; `slug` is unique |
| `org_members` | `role`: `admin` or `member`; unique per `(org_id, user_id)` |
| `platform_admins` | Email allowlist for platform-level admin access |
| `products` | Ardoise products (ui / mc / sw) within an org |
| `subprojects` | Sub-scopes within a product |
| `test_folders` | Folder tree per subproject |
| `test_cases` | Individual test specs; holds `file_content` + `bundled_content` |
| `test_runs` | Playwright run records |
| `run_items` | Per-test-case result within a run |
| `environments` | Named env configs per org |

Later migrations add: RAG vectors (002), SCORM (003-006), GitLab (004-009),
Flows (010), YouTrack (011).

### Auth model

Google OAuth full-page redirect (`GET /api/v1/auth/google`) → callback issues a
**JWT** stored as an `HttpOnly` cookie named `scout_token` (7-day expiry,
`SameSite=Lax`, `Secure` on HTTPS). The JWT payload includes `user_id`, `email`,
`name`, `org_id`, `role`.

Two middleware tiers:
- `Authenticate` — verifies JWT, injects `Claims` into context.
- `RequireOrgMember` / `RequireOrgAdmin` / `RequirePlatformAdmin` — role checks.

Platform admins are seeded from env, not created via normal auth flow.

### Runner

`runner.Service` maintains a queue of `RunJob` structs. `StartWorkers` launches N
goroutines reading from the queue. Each job:
1. Resolves test case file content from DB.
2. Creates a temp workspace directory with a generated `playwright.config.ts`.
3. Symlinks (junction on Windows) the host `node_modules`.
4. Executes `npx playwright test` as a child process.
5. Streams stdout line-by-line via WebSocket (`GET /api/v1/orgs/{orgId}/runs/{runId}/stream`).
6. Parses the JSON results file and saves report + run items back to DB.

Flow runs reuse the same queue via `IsFlow: true` flag (see `flows.md`).

---

## Frontend

### Stack

React 19, react-router-dom v7, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui
(style `radix-sera`, base `neutral`), Zustand for auth state, Axios for HTTP.

### Entry and routing

`src/main.tsx` → `ThemeProvider` → `TooltipProvider` → `AuthBootstrap` → `RouterProvider`.

Routes (`src/router.tsx`):
- `/login`, `/auth/callback`
- `/` — home
- `/dashboard` (inside `DashboardLayout`) — index, `runs`, `pipeline`, `sprints`,
  `ai-assistant`, `settings/{environments,members,archive-queue,ai-config,integrations,organisations}`
- `/projects`, `/projects/:slug`
- `/runs/:runId`

Route guards: `RequireAuth` (redirects to `/login`), `RedirectIfAuthed` (redirects
away from `/login` if already authenticated).

### Auth flow

`AuthBootstrap` calls `GET /api/v1/auth/me` on mount using the `scout_token` cookie.
On 401 it clears the cookie and redirects to `/login`. JWT is never stored in
`localStorage`. The Zustand `useAuthStore` holds `user` + `activeOrg`.

### API layer

Single Axios instance in `src/lib/api.ts`:
- `baseURL`: `${VITE_SCOUT_API_URL || http://localhost:8080}/api/v1`
- Interceptor adds `Authorization: Bearer <token>` from the cookie.
- 401 response → clear cookie + redirect `/login`.

Typed wrappers per domain in `src/lib/scout-api.ts`: `authApi`, `runsApi`,
`pipelinesApi`, `overviewApi`, `environmentsApi`, `membersApi`, `archiveApi`,
`aiConfigApi`, `gitlabApi`, `notificationsApi`, `flowsApi`, `youtrackApi`,
plus `streamChat` SSE helper. Add new endpoints as typed wrappers here — not
inline in components.

### Layout

`DashboardLayout` (`src/pages/dashboard-layout.tsx`) owns sidebar + header.
`SidebarTrigger`, breadcrumb resolved from `pathname` via `resolveTitle`, 
`NotificationsBell`, `ModeToggle`. Static sidebar nav data blob lives in
`src/components/app-sidebar.tsx`.

### Path alias

`@/*` → `./src/*` configured in **both** `tsconfig.json`, `tsconfig.app.json`,
and `vite.config.ts`. Keep all three in sync when changing alias paths.

---

## Three Playwright projects

| Project | Specs | Auth state |
|---|---|---|
| `ui` | `e2e/specs/ui/` | `e2e/.auth/ui-user.json` (bearer JWT) |
| `mission-control` | `e2e/specs/mission-control/` | `e2e/.auth/mc-user.json` (Google SSO/NextAuth) |
| `studio-web` | `e2e/specs/studio-web/` | `e2e/.auth/sw-user.json` (bearer JWT) |

Each has a `-no-auth` variant for auth-spec testing without pre-loaded state.
Product URLs come from `.env.e2e`.

---

## Invariants and gotchas

- Migrations are embedded in the binary and run on every startup — they must be
  idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- The runner needs `node_modules/@playwright/test` accessible. Set
  `SCOUT_PLAYWRIGHT_PROJECT_DIR` in env, or the runner auto-detects by walking up
  from cwd looking for the `node_modules` directory.
- On Windows, junctions are used instead of symlinks for `node_modules` linking
  (no admin rights needed). The junction target must be an absolute path.
- The WebSocket run stream endpoint (`/runs/{runId}/stream`) does not use the JWT
  cookie middleware — the token is passed as a query param `?token=` instead, because
  browsers cannot set headers on WebSocket upgrades.
- `PLATFORM_ADMIN_EMAILS` is the only way to grant platform-admin access.
  There is no UI for promoting users to platform admin.
