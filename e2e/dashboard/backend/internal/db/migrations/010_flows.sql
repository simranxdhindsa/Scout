-- ─────────────────────────────────────────────────────────────────────────────
-- Scout — Migration 010: Cross-platform Flows
-- A flow is an ordered sequence of test steps spanning multiple products.
-- Steps execute sequentially; shared state (env vars) flows between them.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  is_template BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_org ON flows (org_id);

-- A single ordered step within a flow.
-- Either test_case_id OR folder_id must be set (or neither for a placeholder).
CREATE TABLE IF NOT EXISTS flow_steps (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id      UUID        NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  position     INT         NOT NULL,
  name         TEXT        NOT NULL,
  product      TEXT        NOT NULL DEFAULT 'ui'
               CHECK (product IN ('ui', 'mission-control', 'studio-web')),
  test_case_id UUID        REFERENCES test_cases(id) ON DELETE SET NULL,
  folder_id    UUID        REFERENCES folders(id) ON DELETE SET NULL,
  -- JSON array of {"key": "COURSE_ID", "from": "SHARED_COURSE_ID"} — injected as env vars before this step
  env_inputs   JSONB       NOT NULL DEFAULT '[]',
  -- JSON array of {"from": "OUTPUT_COURSE_ID", "to": "SHARED_COURSE_ID"} — extracted from stdout after this step
  env_outputs  JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, position)
);

CREATE INDEX IF NOT EXISTS idx_flow_steps_flow ON flow_steps (flow_id);

-- A single execution of a flow.
CREATE TABLE IF NOT EXISTS flow_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id      UUID        NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'running', 'passed', 'failed', 'stopped')),
  started_by   UUID        REFERENCES users(id),
  -- Accumulated env vars shared across steps during this run
  shared_state JSONB       NOT NULL DEFAULT '{}',
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_flow   ON flow_runs (flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_org    ON flow_runs (org_id);

-- Execution record for each step within a flow_run.
-- run_id links to the underlying test_runs row (the Playwright run).
CREATE TABLE IF NOT EXISTS flow_step_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_run_id  UUID        NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  step_id      UUID        NOT NULL REFERENCES flow_steps(id) ON DELETE CASCADE,
  run_id       UUID        REFERENCES test_runs(id),
  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped')),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_step_runs_flow_run ON flow_step_runs (flow_run_id);
