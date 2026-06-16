# Scout

Playwright e2e test suite and management dashboard for the Ardoise product family.

## Getting Started

### Prerequisites

- Node.js
- Go
- PostgreSQL (NeonDB)

### Install dependencies

```bash
npm install
cd e2e/dashboard/frontend && npm install
```

### Running the app

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend together |
| `npm run be` | Start backend only (Go, port 8080) |
| `npm run fe` | Start frontend only (Vite, port 5173) |
| `npm run kill` | Kill backend process on port 8080 |
| `npm run restart` | Kill + restart backend |

### Running tests

| Command | Description |
|---------|-------------|
| `npm run pw:test` | Run all Playwright specs |
| `npm run pw:test:ui` | Run UI project only |
| `npm run pw:test:mc` | Run Mission Control only |
| `npm run pw:test:sw` | Run Studio Web only |
| `npm run pw:report` | Open HTML test report |
