-- Make GitLab integrations user-specific instead of org-global.
-- Legacy rows are dropped (cascades to product_gitlab_links); everyone reconnects.

DELETE FROM gitlab_integrations;

ALTER TABLE gitlab_integrations
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_gitlab_integrations_org_repo;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gitlab_integrations_org_user_repo
  ON gitlab_integrations(org_id, user_id, repo_id);

CREATE INDEX IF NOT EXISTS idx_gitlab_integrations_org_user
  ON gitlab_integrations(org_id, user_id);

-- A product's GitLab link now owns the sync target (subproject), so any org user
-- with their own integration for the same repo can run a sync.
ALTER TABLE product_gitlab_links
  ADD COLUMN IF NOT EXISTS sub_project_id UUID REFERENCES sub_projects(id) ON DELETE SET NULL;
