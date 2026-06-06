<!--
  Documents: Phase 5 — Slack Notifications, AI Chat History, Scheduled Runs
  Files: internal/db/migrations/012_slack.sql, 013_ai_chat.sql, 014_scheduled_runs.sql
         internal/api/slack.go, internal/api/ai.go (chat sessions)
         internal/api/scheduled_runs.go, internal/scheduler/cron.go
         internal/db/queries/slack.go, internal/db/queries/chat.go, internal/db/queries/scheduled_runs.go
         frontend/src/pages/settings/integrations.tsx (SlackSection)
         frontend/src/pages/ai-assistant.tsx
         frontend/src/pages/settings/scheduled-runs.tsx
-->

# Phase 5 — Slack Notifications, AI Chat History, Scheduled Runs

---

## 1. Slack Webhook Notifications

### What it is
An org-level Slack integration that posts a message to a configured webhook URL when a test run finishes. Two toggles control which outcomes trigger a notification: `notify_on_failure` and `notify_on_success`.

### Database table (`slack_settings`)
```sql
CREATE TABLE slack_settings (
  org_id             UUID PRIMARY KEY REFERENCES organizations(id),
  webhook_url        TEXT NOT NULL DEFAULT '',
  notify_on_failure  BOOLEAN NOT NULL DEFAULT TRUE,
  notify_on_success  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### REST API
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/orgs/:orgId/slack/settings` | Fetch current settings (creates row if absent) |
| `PUT`  | `/api/v1/orgs/:orgId/slack/settings` | Save `webhook_url`, `notify_on_failure`, `notify_on_success` |
| `POST` | `/api/v1/orgs/:orgId/slack/test`     | Send a test message to verify the webhook |

### Frontend
Settings → Integrations → **Slack** card. Enter webhook URL, toggle checkboxes, click Save. Loader spinner on the Save button during the request.

### Notification trigger
The runner calls `SlackService.NotifyRunComplete(ctx, orgID, runID, status)` after a run finishes. It loads settings, checks the relevant toggle, then POSTs the webhook payload if enabled.

---

## 2. AI Chat History (Sessions)

### What it is
Every AI chat conversation is stored as a **session** in the database. Sessions are associated with an org. Messages (user + assistant) are stored per session, allowing chat history to persist across page reloads.

### Database tables
```sql
-- ai_chat_sessions
CREATE TABLE ai_chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id),
  title      TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ai_chat_messages
CREATE TABLE ai_chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### REST API
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/orgs/:orgId/ai/sessions`              | List sessions (most-recent first) |
| `POST` | `/api/v1/orgs/:orgId/ai/sessions`              | Create a new session |
| `GET`  | `/api/v1/orgs/:orgId/ai/sessions/:sessionId/messages` | Get all messages in a session |
| `POST` | `/api/v1/ai/chat` | Stream a chat response; stores user+assistant messages in DB (transactional) |

### AddMessage transaction
`AddMessage` in `internal/db/queries/chat.go` uses a pgx transaction: it updates `ai_chat_sessions.updated_at` and inserts the new message atomically, preventing partial writes.

### Role validation
The `/ai/chat` handler rejects any message with `role` outside `["user", "assistant"]` with HTTP 400, blocking prompt-injection via the `system` role.

### Frontend
`frontend/src/pages/ai-assistant.tsx` — currently a stateless chat UI. The session backend is fully implemented and ready to be wired into a sidebar (session list + history load) in a future iteration.

---

## 3. Scheduled Runs

### What it is
Cron-based automatic test runs. An org admin creates a **schedule** with a cron expression (e.g. `0 9 * * 1` = Monday 9am), a product (ui/mc/sw), optional environment, optional folder scope, and a list of specific test case IDs. The scheduler fires a Scout run at the correct time.

### Database tables (migration 014)
```sql
CREATE TABLE scheduled_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  created_by    UUID REFERENCES users(id),
  label         TEXT NOT NULL DEFAULT 'Scheduled run',
  cron_expr     TEXT NOT NULL,
  product       TEXT NOT NULL DEFAULT 'ui',
  env_id        UUID REFERENCES environments(id),
  folder_id     UUID REFERENCES test_folders(id),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at   TIMESTAMPTZ,
  last_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scheduled_run_tests (
  schedule_id  UUID NOT NULL REFERENCES scheduled_runs(id) ON DELETE CASCADE,
  test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, test_case_id)
);
```

### REST API
| Method   | Path | Description |
|----------|------|-------------|
| `GET`    | `/api/v1/orgs/:orgId/scheduled-runs`                       | List all schedules |
| `POST`   | `/api/v1/orgs/:orgId/scheduled-runs`                       | Create a schedule |
| `PUT`    | `/api/v1/orgs/:orgId/scheduled-runs/:schedId`              | Update a schedule |
| `DELETE` | `/api/v1/orgs/:orgId/scheduled-runs/:schedId`              | Delete a schedule |
| `POST`   | `/api/v1/orgs/:orgId/scheduled-runs/:schedId/toggle`       | Toggle enabled/disabled |

### Cron validation
`parseScheduledRunBody` calls `cronexpr.Parse(cronExpr)` before writing to DB. Invalid expressions return HTTP 400.

### Scheduler (`internal/scheduler/cron.go`)
- Polls DB every minute for schedules where `next_run_at <= NOW() AND enabled = TRUE`
- `fire()`: loads test case IDs; if none → early return (does **not** advance `next_run_at`, so it retries next minute)
- On success: creates a Scout run, advances `next_run_at` to the next tick via `cronexpr.Next`

### Frontend (`settings/scheduled-runs.tsx`)
Settings → Scheduled Runs:
- Table of schedules with label, cron expression, product, next run time, enabled toggle
- **Create / Edit dialog**: cron preset selector (Every day 9am / Every Monday 9am / Every hour / Custom) + product picker + test case multi-select
- Delete confirmation inline
- Toggle switch enables/disables without opening the edit dialog

---

## Security fixes (Phase 5 QA)

| Area | Fix |
|------|-----|
| Entity-scoped routes (`/folders/:folderId`, `/tests/:testId`, etc.) | Added `auth_helpers.go` — `orgIDForFolder/Test/SubProject/Run` DB lookups + `memberCheck` so all handlers enforce org membership without a top-level orgId in the path |
| `/ai/chat` role injection | Handler rejects `role != "user" \| "assistant"` with HTTP 400 |
| Cron silently stored invalid expressions | `parseScheduledRunBody` validates with `cronexpr.Parse` → HTTP 400 |
| Scheduler fires on empty schedule | `fire()` returns early when no test cases; `next_run_at` not advanced |
| `FailItems` error silently dropped | Runner now logs the error instead of `_ = s.runQ.FailItems(...)` |
| `GetByID` after Update returns null 200 | Update handler checks the error and returns HTTP 500 on failure |
| Double session creation race (AI chat) | `pendingSessionRef` prevents concurrent `createSession` calls |
| `AddMessage` non-atomic | Wrapped in pgx transaction to update session `updated_at` + insert atomically |
