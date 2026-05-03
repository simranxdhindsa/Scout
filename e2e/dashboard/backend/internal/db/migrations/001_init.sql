-- ─────────────────────────────────────────────────────────────────────────────
-- Scout QA Platform — Migration 001: Initial Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ─────────────────────────────────────────────
-- PLATFORM LEVEL
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_admins (
  email TEXT PRIMARY KEY
);

-- ─────────────────────────────────────────────
-- USERS & ORGANIZATIONS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        UNIQUE NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  slug       TEXT        UNIQUE NOT NULL,
  theme      JSONB       DEFAULT '{}',       -- {primary_color, logo_url, favicon_url}
  is_active  BOOLEAN     DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org  ON org_members (org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members (user_id);

-- ─────────────────────────────────────────────
-- PRODUCTS & SUB-PROJECTS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  description TEXT,
  icon        TEXT,                           -- emoji or icon name
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_products_org ON products (org_id);

CREATE TABLE IF NOT EXISTS sub_projects (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  slug       TEXT        NOT NULL,
  auth_type  TEXT        NOT NULL DEFAULT 'credentials'
             CHECK (auth_type IN ('credentials', 'google_oauth', 'none')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_subprojects_product ON sub_projects (product_id);

-- Per-member, per-sub-project access control
CREATE TABLE IF NOT EXISTS project_access (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_member_id     UUID    NOT NULL REFERENCES org_members(id) ON DELETE CASCADE,
  sub_project_id    UUID    NOT NULL REFERENCES sub_projects(id) ON DELETE CASCADE,
  can_write         BOOLEAN DEFAULT TRUE,
  can_request_delete BOOLEAN DEFAULT TRUE,
  UNIQUE(org_member_id, sub_project_id)
);

-- ─────────────────────────────────────────────
-- ENVIRONMENTS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS environments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,            -- 'Dev', 'Stage', 'Prod', or custom
  label      TEXT,                            -- friendly display name
  created_by UUID        REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_environments_org ON environments (org_id);

-- Each sub-project can override base URL per environment
CREATE TABLE IF NOT EXISTS subproject_env_urls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_project_id UUID NOT NULL REFERENCES sub_projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  base_url       TEXT NOT NULL,
  UNIQUE(sub_project_id, environment_id)
);

-- ─────────────────────────────────────────────
-- TEST FOLDERS (INFINITE NESTING)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS test_folders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_project_id UUID        NOT NULL REFERENCES sub_projects(id) ON DELETE CASCADE,
  parent_id      UUID        REFERENCES test_folders(id) ON DELETE CASCADE,  -- NULL = root
  name           TEXT        NOT NULL,
  -- Materialized path for fast subtree queries: '/parent-id/this-id'
  path           TEXT        NOT NULL DEFAULT '',
  created_by     UUID        REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folders_path       ON test_folders USING btree (path);
CREATE INDEX IF NOT EXISTS idx_folders_subproject ON test_folders (sub_project_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent     ON test_folders (parent_id);

-- ─────────────────────────────────────────────
-- TEST CASES
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS test_cases (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id     UUID        NOT NULL REFERENCES test_folders(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  description   TEXT,
  file_name     TEXT        NOT NULL,          -- original uploaded filename
  file_content  TEXT        NOT NULL,          -- raw .ts / .js source (for editing)
  bundled_content TEXT,                        -- esbuild output (for execution)
  is_archived   BOOLEAN     DEFAULT FALSE,
  version       INTEGER     DEFAULT 1,
  created_by    UUID        REFERENCES users(id),
  updated_by    UUID        REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tests_folder     ON test_cases (folder_id);
CREATE INDEX IF NOT EXISTS idx_tests_archived   ON test_cases (is_archived);

-- Full version history (audit trail)
CREATE TABLE IF NOT EXISTS test_case_versions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id UUID        NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  version      INTEGER     NOT NULL,
  file_content TEXT        NOT NULL,
  changed_by   UUID        REFERENCES users(id),
  changed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_versions_case ON test_case_versions (test_case_id);

-- ─────────────────────────────────────────────
-- PIPELINES (CROSS-PRODUCT FLOWS)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipelines (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_org ON pipelines (org_id);

CREATE TABLE IF NOT EXISTS pipeline_steps (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id    UUID    NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  step_order     INTEGER NOT NULL,
  target_type    TEXT    NOT NULL CHECK (target_type IN ('test_case', 'folder')),
  target_id      UUID    NOT NULL,
  sub_project_id UUID    REFERENCES sub_projects(id),
  environment_id UUID    REFERENCES environments(id),
  on_failure     TEXT    NOT NULL DEFAULT 'halt' CHECK (on_failure IN ('halt', 'continue')),
  UNIQUE(pipeline_id, step_order)
);

-- ─────────────────────────────────────────────
-- TEST RUNS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS test_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_id    UUID        REFERENCES pipelines(id),
  environment_id UUID        REFERENCES environments(id),
  triggered_by   UUID        REFERENCES users(id),
  status         TEXT        NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','failed','stopped')),
  -- Credentials stored ONLY until runner picks up the job, then cleared to NULL
  credentials_tmp JSONB,
  label          TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_org    ON test_runs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON test_runs (status);

-- Individual test case results within a run
CREATE TABLE IF NOT EXISTS run_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID        NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  test_case_id  UUID        REFERENCES test_cases(id),
  pipeline_step INTEGER,
  status        TEXT        CHECK (status IN ('queued','running','passed','failed','skipped','timedOut')),
  duration_ms   INTEGER,
  error_message TEXT,
  error_stack   TEXT,
  retry_count   INTEGER     DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_run_items_run ON run_items (run_id);

-- Aggregated report for a run
CREATE TABLE IF NOT EXISTS run_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID        NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE UNIQUE,
  passed          INTEGER     DEFAULT 0,
  failed          INTEGER     DEFAULT 0,
  skipped         INTEGER     DEFAULT 0,
  timed_out       INTEGER     DEFAULT 0,
  total           INTEGER     DEFAULT 0,
  duration_ms     INTEGER,
  report_url      TEXT,                        -- Phase 1: local path; Phase 2: S3 URL
  raw_json        JSONB,                       -- full Playwright JSON output
  console_errors  INTEGER     DEFAULT 0,
  api_errors      INTEGER     DEFAULT 0,
  failed_requests INTEGER     DEFAULT 0,
  page_errors     INTEGER     DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Attachments: screenshots, traces, videos, network logs
CREATE TABLE IF NOT EXISTS run_attachments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_item_id UUID        NOT NULL REFERENCES run_items(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('screenshot','trace','video','network-log')),
  storage_url TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_item ON run_attachments (run_item_id);

-- ─────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  run_id     UUID        REFERENCES test_runs(id) ON DELETE SET NULL,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  message    TEXT,
  read       BOOLEAN     DEFAULT FALSE,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_org  ON notifications (org_id, created_at DESC);

-- ─────────────────────────────────────────────
-- ARCHIVE QUEUE (SOFT DELETE APPROVAL)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS archive_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  test_case_id   UUID        NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  reason         TEXT,
  requested_by   UUID        REFERENCES users(id),
  status         TEXT        DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by    UUID        REFERENCES users(id),
  review_comment TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archive_org    ON archive_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_archive_status ON archive_requests (status);

-- ─────────────────────────────────────────────
-- SESSIONS
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        UNIQUE NOT NULL,      -- SHA-256 of JWT
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);
