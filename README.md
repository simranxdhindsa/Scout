# Ardoise E2E Test Suite

Playwright end-to-end tests for the three Ardoise products: **Mission Control**, **Studio-Web**, and **UI** (student platform).

---

## Products Under Test

| Product | Description | URL |
|---|---|---|
| Mission Control | Admin CMS for managing courses, bundles, orgs | `PLAYWRIGHT_MC_URL` |
| Studio-Web | Content creator / authoring tool | `PLAYWRIGHT_SW_URL` |
| UI | Student-facing learning platform | `PLAYWRIGHT_UI_URL` |

---

## Prerequisites

- Node.js 18+
- Go 1.21+ (required for the dashboard backend)
- A valid Google account with access to Mission Control (for MC auth)
- Bearer tokens for Studio-Web and UI (fnac domain JWT)

---

## Setup

### 1. Install dependencies

```bash
npm install
npm run pw:install
```

### 2. Configure environment

```bash
cp .env.e2e.example .env.e2e
```

Fill in `.env.e2e` with your credentials:

```env
# UI (student platform)
PLAYWRIGHT_UI_URL=https://your-tenant.ardoirse.com
PLAYWRIGHT_UI_EMAIL=your-ui-email@example.com
PLAYWRIGHT_UI_PASSWORD=your-ui-password

# Mission Control
PLAYWRIGHT_MC_URL=https://mc.ardoirse.com
PLAYWRIGHT_MC_EMAIL=your-mc-email@example.com
PLAYWRIGHT_MC_PASSWORD=your-mc-password

# Studio-Web
PLAYWRIGHT_SW_URL=https://studio.ardoirse.com
PLAYWRIGHT_SW_EMAIL=your-sw-email@example.com
PLAYWRIGHT_SW_PASSWORD=your-sw-password
```

> `.env.e2e` is gitignored — never commit it.

---

## Auth Notes

- **Mission Control** uses Google SSO. On first run, `global-setup` opens a **headed browser** and waits up to 2 minutes for you to complete the Google login. The session is cached in `e2e/.auth/mc-user.json` for ~23 hours.
- **Studio-Web & UI** use bearer tokens injected directly as cookies — no browser interaction needed.
- Auth cache is stored in `e2e/.auth/` (gitignored). Delete these files to force re-authentication.

---

## Dashboard (recommended interface)

The dashboard is the single interface for running tests, recording new ones, and viewing reports — no terminal needed after the initial setup.

### Prerequisites

- [Go 1.21+](https://go.dev/dl/) must be installed and on your `PATH`

### Start (development — hot-reload on both frontend and backend)

```bash
npm run pw:dashboard:dev
```

Opens at **http://localhost:5173**

### Start (production build)

```bash
npm run pw:dashboard:build   # build frontend once
npm run pw:dashboard         # serve at http://localhost:4000
```

### What you can do from the dashboard

| Feature | Where |
|---|---|
| Run all tests / by product | Run & Record tab |
| Record new tests (codegen) | Run & Record tab → Record New Test |
| View test reports & results | Reports tab |
| Check auth session status | Run & Record tab |

---

## Running Tests (CLI)

```bash
# Open Playwright GUI (recommended — watch tests run live)
npm run pw:ui

# Run all tests headless
npm run pw:test

# Run one product only
npm run pw:test:mc       # Mission Control
npm run pw:test:ui       # Student UI
npm run pw:test:sw       # Studio-Web

# Run headed (visible browser)
npm run pw:test:headed

# Run in debug mode (step through)
npm run pw:test:debug

# View last HTML report
npm run pw:report

# Update visual snapshots (after intentional UI changes)
npm run pw:update-snapshots
```

### Recording / Codegen (CLI)

Prefer the dashboard "Record New Test" button — it handles auth and URLs automatically. For manual CLI use:

```bash
# Record on Mission Control
npm run pw:codegen:mc

# Record on Studio-Web
npm run pw:codegen:sw

# Record on UI / student platform
npm run pw:codegen:ui
```

**Workflow:**
1. Click **Record New Test** in the dashboard (or run a codegen command above)
2. A browser + Playwright Inspector opens — you are already logged in
3. Click through the full flow you want to test
4. Copy the generated code from the Inspector panel
5. Save it as a spec file under `e2e/specs/<product>/`

> Make sure global-setup has run at least once so the `.auth/` files exist.
> If auth is expired, delete the relevant `.auth/*.json` file and re-run `npm run pw:ui` to refresh it.

---

## Folder Structure

```
e2e/
├── specs/
│   ├── mission-control/
│   │   ├── auth/
│   │   ├── bundles/
│   │   ├── configurations/
│   │   ├── courses/
│   │   ├── navigation/
│   │   ├── organisations/
│   │   └── security/
│   ├── studio-web/
│   │   ├── auth/
│   │   ├── navigation/
│   │   ├── projects/
│   │   ├── security/
│   │   ├── visual/
│   │   └── weaver/
│   └── ui/
│       ├── admin/
│       ├── auth/
│       ├── courses/
│       ├── cross-cutting/
│       ├── dashboard/
│       ├── navigation/
│       ├── pages/
│       ├── security/
│       └── visual/
├── fixtures/          # Playwright fixtures (auth, page objects)
├── pages/             # Page object models
├── utils/             # Shared helpers and test data generators
├── scripts/           # Report saving and other scripts
├── dashboard/         # Local HTML test dashboard
├── global-setup.ts    # Auth setup (runs before all tests)
├── global-teardown.ts
├── playwright.config.ts
└── tsconfig.json
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| MC login fails / times out | Delete `e2e/.auth/mc-user.json` and re-run — complete Google login within 2 min |
| UI/SW auth error | Check that tokens in `.env.e2e` are valid and not expired |
| Selector not found | Open Playwright GUI → click the failing test → inspect DOM snapshot |
| Test flaky / timeout | Increase `timeout` in `playwright.config.ts` or add `waitFor` in the test |
| 4xx API errors | Check Network tab in Playwright trace for the actual error response |

