-- Slack webhook notification settings per org

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_notify_on_failure BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_notify_on_success BOOLEAN NOT NULL DEFAULT FALSE;
