-- GitLab repository integrations per org
CREATE TABLE IF NOT EXISTS gitlab_integrations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subproject_id    UUID        REFERENCES sub_projects(id) ON DELETE SET NULL,
  gitlab_user_id   TEXT        NOT NULL,
  gitlab_username  TEXT        NOT NULL,
  gitlab_avatar    TEXT,
  access_token     TEXT        NOT NULL,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  repo_id          BIGINT      NOT NULL,
  repo_name        TEXT        NOT NULL,
  repo_url         TEXT        NOT NULL,
  branch           TEXT        NOT NULL DEFAULT 'main',
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gitlab_integrations_org_repo
  ON gitlab_integrations(org_id, repo_id);
