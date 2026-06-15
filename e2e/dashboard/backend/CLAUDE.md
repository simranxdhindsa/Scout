# CLAUDE.md — Scout Backend

Guidance for working in the Scout dashboard **Go backend** (`e2e/dashboard/backend/`, module `github.com/apyhub/scout`). The root `CLAUDE.md` holds the monorepo overview and the full HTTP endpoint catalog — this file documents the backend's *conventions and mechanics*, not the endpoint list.

## Commands

- `go run ./cmd/server/main.go` — start the API server (port from `PORT`, default `8080`). From repo root: `npm run pw:dashboard:backend`.
- `go build ./...` — compile everything.
- `go vet ./...` — static checks.
- `go run ./cmd/gentoken` — dev helper that mints a 7-day JWT for an existing user (see caveat below).

Go **1.22** (relies on the `net/http` `ServeMux` method+pattern routing, e.g. `"GET /api/v1/..."` and `r.PathValue(...)`). There is **no test suite** (`*_test.go` count is 0) — don't claim tests pass; verify by building and running.

## Layout

```
cmd/
  server/   main.go — composition root (wires config → db → services → routes)
  gentoken/ dev-only JWT minter
internal/
  api/        HTTP handlers (one file per area) + router.go + middleware.go
  auth/       Google OAuth, JWT issue/validate/revoke, auth middleware
  config/     env-var loading into config.Config
  db/         pgxpool connect + embedded SQL migrations; queries/ = hand-written SQL
  runner/     queued Playwright execution + WebSocket live streaming
  scheduler/  cron engine for scheduled runs
  scorm/      SCORM upload/generation + Phoenix poller
  ai/         Groq LLM, RAG/vector store, test generator, run analyzer
  notifications/ in-app notifications
  gitlab/ youtrack/ slack/  third-party integrations
  storage/    Storage interface — local FS or S3, chosen by STORAGE_DRIVER
data/         local storage root (run artifacts, attachments) when STORAGE_DRIVER=local
```

## Startup sequence (`cmd/server/main.go`)

`main.go` is the single composition root and runs in fixed order: **load config → connect db → run migrations → seed platform admins → init storage → build services (`notifications`, `ai`, `runner` + `StartWorkers`, `scorm` + `SeedGenerators`, `auth`, `gitlab`, `youtrack`) → start `scheduler` → register routes → serve with graceful shutdown.**

- A `rootCtx` (cancellable) scopes long-lived background goroutines (rate-limit cleanup, scheduler, runner workers) to the server lifetime; `rootCancel()` runs on SIGINT/SIGTERM before a 30s graceful `srv.Shutdown`.
- New services are constructed here and passed into `api.Services`. **To add a service:** add a field to `api.Services` (`router.go`), construct it in `main.go`, and thread it through.

## Routing & handlers (`internal/api/`)

- **One file per domain area** (`runs.go`, `flows.go`, `scheduled_runs.go`, …). All routes are registered in `router.go`'s `RegisterRoutes`.
- **Handler struct pattern:** each area defines `type xHandler struct { svc Services }` + `newXHandler(svc) *xHandler`, with methods `func (h *xHandler) Verb(w, r)`. (A few services like SCORM expose handler methods directly: `svc.SCORM.HandleUpload`.)
- **Middleware composition:** `chain(handlerFn, m1, m2, ...)` wraps the handler so `m1` is outermost. Order matters — e.g. `chain(h.Create, svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin)`. `RequireOrgAdmin` **must** come after `RequireOrgMember` (it reads the org role that `RequireOrgMember` puts in context).
- **Global middleware** (`middleware.go`, applied to the whole mux via `mid.wrap`): CORS → rate limit (token bucket, 60 rps / 120 burst per IP, cleanup goroutine on `rootCtx`) → request logger. The logger's `responseWriter` wrapper implements `Hijack` and `Flush` so **WebSocket upgrades and SSE streaming keep working** — preserve those if you touch it.
- **Public (no auth) routes:** `/health`, the Google + GitLab OAuth callbacks. The **WebSocket run stream** (`GET /runs/{runId}/stream`) is registered *without* the `Authenticate` middleware because the token comes as a query param, not a header — auth happens inside the handler.

### Handler conventions

- **Path params:** `r.PathValue("orgId")` then `uuid.Parse` — on failure `writeError(w, "invalid orgId", http.StatusBadRequest)`.
- **JSON I/O helpers** (defined in `orgs.go`, shared package-wide):
  - `writeJSON(w, status, v)` — sets `Content-Type` and encodes.
  - `writeError(w, msg, status)` — emits `{"error": msg}`. **The frontend's `readError` depends on this exact shape — always use it for errors.**
  - `decodeBody(r, &v)` — decodes the request body.
- **Auth context:** `auth.ClaimsFromContext(r.Context())` for the JWT claims (`claims.UserID`, `claims.Email`, `claims.IsPlatAdmin`); `auth.OrgRoleFromContext` / `auth.UserIDFromContext` for the rest.
- **List endpoints normalize nil to `[]`** before encoding (so the frontend never sees `null` for a collection), and usually wrap in a named key, e.g. `{"scheduled_runs": [...]}`.
- **Org-scoping for non-`{orgId}` routes:** routes keyed by sub-project/folder/test/run id (which lack `RequireOrgMember`) resolve the owning org and verify membership via the helpers in `auth_helpers.go` (`orgIDForSubProject`, `orgIDForFolder`, `orgIDForTest`, `orgIDForRun`, `memberCheck`). Use these instead of trusting the caller.
- **Ownership checks:** mutations re-fetch the row and confirm `existing.OrgID == orgID` before acting (returning 404 otherwise) — see `scheduled_runs.go` for the canonical pattern.

## Database (`internal/db/`)

- **pgx/v5 `pgxpool`** (`MaxConns 20`, `MinConns 2`). The `*pgxpool.Pool` lives on `Services.DB`.
- **No ORM, no sqlc** — hand-written SQL. Query structs live in `internal/db/queries/` (`NewXQueries(pool)` → methods running `pool.Query`/`QueryRow`). Ad-hoc SQL in handlers/middleware uses positional `$1` params.
- **Migrations** (`db.go` `RunMigrations`, run automatically on startup):
  - Plain `.sql` files in `internal/db/migrations/`, embedded via `//go:embed`.
  - Applied in **alphabetical order** — keep the `NNN_name.sql` zero-padded prefix (next is `016_`).
  - Tracked in a `schema_migrations` table; each file runs once, in its own transaction. **Migrations are append-only and forward-only — never edit an applied file; add a new one.** There is no down/rollback mechanism.

## Auth (`internal/auth/`)

- Google OAuth (`google.go`) → user upsert → JWT issued by `jwtManager` (`jwt.go`, HS256 from `JWT_SECRET`, 7-day expiry, claims `uid`/`email`/`is_plat_admin`).
- Tokens are **revocable**: validation checks a DB denylist by SHA-256 hash; `RevokeToken` (logout) inserts the hash.
- Middleware (`middleware.go`): `Authenticate` (validates Bearer, stores `*Claims` in ctx) → `RequireOrgMember` (checks active `org_members` row, stores role) → `RequireOrgAdmin` (role must be `admin`) / `RequirePlatformAdmin` (`is_plat_admin`). Context keys are unexported; always read via the `*FromContext` helpers.
- Platform admins are seeded on boot from `PLATFORM_ADMIN_EMAILS`.

## Config & env vars (`internal/config/`)

`config.Load()` reads env into `config.Config` (fails fast on required values). Keys:
`PORT`, `ENVIRONMENT` (`development`|`production`), `DATABASE_URL`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URL`, `JWT_SECRET`, `STORAGE_DRIVER` (`local`|`s3`), `STORAGE_LOCAL_DIR` (default `./data`), `GROQ_API_KEY`, `GITLAB_CLIENT_ID/SECRET`, `GITLAB_BASE_URL`, `PHOENIX_BASE_URL`, `PLATFORM_ADMIN_EMAILS` (comma-separated), `MAX_CONCURRENT_RUNS` (default 3), `FRONTEND_URL` (CORS allow-origin + default 3000), `BACKEND_URL`.

Integrations degrade gracefully when unconfigured (e.g. GitLab logs "disabled" if `GITLAB_CLIENT_ID` is unset) — follow that pattern for new optional integrations rather than failing startup.

## Storage (`internal/storage/`)

`storage.New(cfg)` returns a `Storage` interface backed by local FS or S3 per `STORAGE_DRIVER`. Handlers use the interface (`Get`, etc.) and never assume a driver. When `STORAGE_DRIVER=local`, `GET /api/v1/storage/{key...}` is wired to stream files; with S3 that route is omitted.

## Runner & scheduler

- `runner.NewService(pool, store, notifSvc, aiSvc, maxConcurrent)` + `StartWorkers(ctx)` — a queued worker pool executing Playwright runs, streaming live output over WebSocket, persisting artifacts via `storage`, and emitting notifications. Bounded by `MAX_CONCURRENT_RUNS`.
- `scheduler.NewService(pool, runnerSvc).Start(rootCtx)` — cron engine. Cron expressions are parsed/validated with `github.com/gorhill/cronexpr`; `scheduler.NextAfter(expr, now)` computes the next fire time stored as `next_run_at`.

## ⚠️ `cmd/gentoken` caveat

`cmd/gentoken/main.go` currently has a **hardcoded NeonDB connection string, JWT secret, and target email** inline. It's a throwaway dev helper. Treat those literals as compromised/dev-only — do not rely on them, and flag if asked to harden auth. (Worth rotating that DB credential and parameterizing this tool, but that's out of scope for routine changes.)
