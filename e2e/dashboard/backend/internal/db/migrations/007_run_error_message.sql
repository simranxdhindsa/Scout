-- Capture why a run failed so the dashboard can surface the reason.
ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
