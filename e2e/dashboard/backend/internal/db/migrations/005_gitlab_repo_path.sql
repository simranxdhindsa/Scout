-- Add repo_path to scope syncing to a subfolder within the repo
ALTER TABLE gitlab_integrations ADD COLUMN IF NOT EXISTS repo_path TEXT NOT NULL DEFAULT '';