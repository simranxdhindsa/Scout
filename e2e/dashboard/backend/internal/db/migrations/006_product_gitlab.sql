-- Per-product GitLab repo selection.
-- A product picks one GitLab integration (org-level OAuth account) and
-- chooses a repo/branch/subfolder within it. One row per product.
CREATE TABLE IF NOT EXISTS product_gitlab_links (
  product_id     UUID        PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  integration_id UUID        NOT NULL REFERENCES gitlab_integrations(id) ON DELETE CASCADE,
  repo_id        BIGINT      NOT NULL,
  repo_name      TEXT        NOT NULL,
  repo_url       TEXT        NOT NULL,
  branch         TEXT        NOT NULL DEFAULT 'main',
  repo_path      TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_gitlab_links_integration
  ON product_gitlab_links(integration_id);
