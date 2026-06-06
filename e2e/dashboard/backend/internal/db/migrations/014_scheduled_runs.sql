-- Scheduled (cron-based) test runs

CREATE TABLE IF NOT EXISTS scheduled_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label        TEXT        NOT NULL DEFAULT 'Scheduled run',
  cron_expr    TEXT        NOT NULL DEFAULT '0 9 * * 1',
  env_id       UUID        REFERENCES environments(id) ON DELETE SET NULL,
  test_case_ids JSONB      NOT NULL DEFAULT '[]',
  folder_id    UUID        REFERENCES test_folders(id) ON DELETE SET NULL,
  product      TEXT        NOT NULL DEFAULT 'ui',
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  last_run_at  TIMESTAMPTZ,
  next_run_at  TIMESTAMPTZ,
  created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_runs_org     ON scheduled_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_enabled ON scheduled_runs(enabled, next_run_at) WHERE enabled = TRUE;
