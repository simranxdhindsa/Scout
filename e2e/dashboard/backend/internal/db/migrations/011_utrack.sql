-- YouTrack sprint-testing integration

CREATE TABLE IF NOT EXISTS youtrack_integrations (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_url   TEXT    NOT NULL DEFAULT '',
  token      TEXT    NOT NULL DEFAULT '',
  project_id TEXT    NOT NULL DEFAULT '',
  board_id   TEXT    NOT NULL DEFAULT '',
  connected  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

CREATE TABLE IF NOT EXISTS youtrack_ticket_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id    TEXT NOT NULL,
  ticket_title TEXT NOT NULL DEFAULT '',
  test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, ticket_id, test_case_id)
);
