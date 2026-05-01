# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A self-hosted Playwright E2E test platform with three runnable pieces:

| Layer | Location | Runtime |
|---|---|---|
| Test runner + specs | repo root | Node / Playwright |
| Dashboard backend | `dashboard/backend/` | Go 1.21, port 4000 |
| Dashboard frontend | `dashboard/frontend/` | Vite + React, port 5173 |

## Commands

### Playwright (run from repo root)

```sh
pnpm exec playwright install --with-deps   # first-time browser install
pnpm run pw:test                           # run all products + archive results
pnpm run pw:test:<product>                 # run one product + archive results
pnpm exec playwright test --project=<name> # run without archiving
pnpm exec playwright test specs/foo/bar.spec.ts  # single file
pnpm exec playwright test --headed         # headed mode
pnpm exec playwright codegen <url>         # record a new test
```

### Go backend (run from repo root)

```sh
pnpm run dashboard:backend     # cd dashboard/backend && go run .
# or directly:
cd dashboard/backend && go run .
cd dashboard/backend && go build -o backend .
cd dashboard/backend && go vet ./...
```

### Frontend (run from `dashboard/frontend/`)

```sh
pnpm install
pnpm run dev       # Vite dev server, hot reload
pnpm run build     # tsc + vite build
pnpm run lint      # eslint
pnpm run preview   # preview production build
```

## Architecture

### Product model

A *product* is a named group of specs that shares an auth session. Adding one requires three touches:

1. **`playwright.config.ts`** — add `{ name: 'foo', baseURL: process.env.FOO_URL ?? '' }` to the `products` array. This auto-generates a `setup-foo` project and a `foo` test project with `storageState: '.auth/foo-user.json'`.
2. **`.env.e2e`** — add `FOO_URL`, `FOO_EMAIL`, `FOO_PASSWORD`.
3. **`package.json`** — add `"pw:test:foo": "playwright test --project=foo && node scripts/save-report.js"`.

Create specs at `specs/foo/*.spec.ts` and import `test` from `../../fixtures/network-logger` (not from `@playwright/test`) to get automatic network capture.

### Auth flow

`global-setup.ts` is a Playwright test file matched by every `setup-{product}` project. It reads `testInfo.project.name` to derive the product, checks `.auth/{product}-user.json` age (skips re-auth if < 23 h), then fills email/password from env vars and saves `storageState`. The login selectors in `global-setup.ts` are generic — replace them with product-specific ones.

### Network logger fixture (`fixtures/network-logger.ts`)

An `auto: true` fixture that intercepts `console errors`, `4xx/5xx responses`, `requestfailed`, and `pageerror` events for every test. On teardown it attaches a `network-log` JSON to the test result. `scripts/save-report.js` reads these attachments to populate `errorSummary` in `meta.json`.

### Post-run archival (`scripts/save-report.js`)

Runs after every `playwright test` invocation via `&&` in npm scripts. Copies `reports/results.json` and `reports/html/` into a timestamped directory under `reports/runs/` and writes `meta.json` (pass/fail counts + errorSummary). The Go server reads `meta.json` to power `GET /api/runs`.

### Go backend (`dashboard/backend/server.go`)

Single-file server, no framework. Key design points:
- All shared run state (output buffer, status, pgid) is protected by a single `sync.Mutex` on the `runState` struct.
- Only one Playwright run at a time; `POST /api/run` returns 409 while one is active.
- Process group (`syscall.SysProcAttr{Setpgid: true}`) is used so `DELETE /api/run` can `SIGKILL` the entire npm + node + playwright subtree.
- `rootDir` is resolved at startup as `../../` relative to the server's working directory, pointing to the repo root where npm scripts and reports live.
- Path traversal is blocked in all file-serving endpoints via `safeChild(rootDir, absPath)`.

### Reports layout

```
reports/
  results.json      ← latest run (overwritten each run)
  html/             ← latest HTML report
  runs/
    {timestamp}/
      results.json
      html/
      meta.json
```

`GET /reports/{timestamp}/html/*` on the Go server serves archived HTML reports directly.

## Environment

Copy `.env.e2e.example` → `.env.e2e`. Variables follow the pattern `{PRODUCT_UPPER}_URL`, `{PRODUCT_UPPER}_EMAIL`, `{PRODUCT_UPPER}_PASSWORD`. This file is gitignored.

## CI

`.github/workflows/playwright.yml` runs `pnpm exec playwright test` on push/PR to main. It does **not** run `save-report.js` or start the Go backend — those are local-only. The workflow uploads `playwright-report/` as an artifact (30-day retention).
