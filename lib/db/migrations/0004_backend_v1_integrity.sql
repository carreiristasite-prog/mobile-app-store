-- Expand-only compatibility migration for environments that executed 0003
-- before concurrency-safe attempt and billing snapshots were introduced.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS mastery_probability double precision;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS mastery_observations integer;
UPDATE attempts SET mastery_probability = 0.35 WHERE mastery_probability IS NULL;
UPDATE attempts SET mastery_observations = 0 WHERE mastery_observations IS NULL;
ALTER TABLE attempts ALTER COLUMN mastery_probability SET NOT NULL;
ALTER TABLE attempts ALTER COLUMN mastery_observations SET NOT NULL;

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS source_occurred_at timestamptz;
UPDATE entitlements AS entitlement
SET source_occurred_at = COALESCE(
  (SELECT event.occurred_at FROM subscription_events AS event
   WHERE event.provider_event_id = entitlement.source_event_id LIMIT 1),
  entitlement.updated_at,
  entitlement.starts_at
)
WHERE entitlement.source_occurred_at IS NULL;
ALTER TABLE entitlements ALTER COLUMN source_occurred_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_session_user_mode_started
  ON learning_sessions(user_id, mode, started_at);
CREATE INDEX IF NOT EXISTS idx_exposure_user_exposed_at
  ON item_exposures(user_id, exposed_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_target_status
  ON reports(reporter_user_id, target_type, target_id, status);

DO $$ BEGIN
  ALTER TABLE attempts ADD CONSTRAINT ck_attempt_mastery_probability
    CHECK (mastery_probability BETWEEN 0 AND 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE attempts ADD CONSTRAINT ck_attempt_mastery_observations
    CHECK (mastery_observations >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0004_backend_v1_integrity', CURRENT_TIMESTAMP) ON CONFLICT(hash) DO NOTHING;
