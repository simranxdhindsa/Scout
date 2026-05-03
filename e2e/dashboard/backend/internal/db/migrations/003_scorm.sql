-- ─────────────────────────────────────────────────────────────────────────────
-- Scout QA Platform — Migration 003: SCORM Scraping Module
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- SCORM GENERATORS REGISTRY
-- Seeded from Go code on startup — not hardcoded in config.
-- Org admins can activate/deactivate generators from the dashboard.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scorm_generators (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key    TEXT        UNIQUE NOT NULL,     -- e.g. 'scorm12_basic', 'break_xss_manifest'
  name        TEXT        NOT NULL,
  category    TEXT        NOT NULL CHECK (category IN ('valid', 'edge', 'break')),
  description TEXT,
  expected    TEXT,                            -- what Phoenix should do with this package
  filename    TEXT        NOT NULL,            -- generated .zip filename
  is_active   BOOLEAN     DEFAULT TRUE,
  sort_order  INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generators_category ON scorm_generators (category, is_active);

-- ─────────────────────────────────────────────
-- SCORM SNAPSHOTS
-- Each upload/generate → scrape cycle creates one snapshot.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scorm_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Source: either a user-uploaded file or a generated package
  source_type     TEXT        NOT NULL CHECK (source_type IN ('upload', 'generated')),
  generator_id    UUID        REFERENCES scorm_generators(id) ON DELETE SET NULL,
  -- Original file metadata
  original_name   TEXT        NOT NULL,        -- original zip filename
  storage_url     TEXT,                        -- where the .zip is stored (local / S3)
  file_size_bytes BIGINT,
  -- Phoenix job tracking
  job_id          TEXT,                        -- Phoenix job_id returned on upload
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','complete','error','failed','timeout')),
  cached          BOOLEAN     DEFAULT FALSE,   -- Phoenix returned cached result
  -- Scraping results (populated when status = 'complete')
  result_json     JSONB,                       -- full PhoenixResult payload
  coverage_pct    FLOAT,                       -- extracted coverage percentage
  sco_count       INTEGER,                     -- number of SCOs found
  language_codes  TEXT[],                      -- detected languages e.g. ['fr', 'en']
  error_detail    TEXT,                        -- populated on error/failed/timeout
  -- Who and when
  uploaded_by     UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_org        ON scorm_snapshots (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_status     ON scorm_snapshots (status);
CREATE INDEX IF NOT EXISTS idx_snapshots_generator  ON scorm_snapshots (generator_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_source     ON scorm_snapshots (source_type);
