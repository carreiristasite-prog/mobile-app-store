-- Additive, fail-closed delivery evidence for private DSR exports. This does
-- not approve a retention policy, execute a lifecycle rule or close DSR-001.
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_object_generation text;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_revoked_at timestamptz;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_revocation_required boolean NOT NULL DEFAULT true;

-- Legacy completed exports cannot be safely generation-pinned retroactively;
-- revoke delivery rather than guessing. Legacy completed deletion protocols
-- predate this step and remain historically closed without fabricated proof.
UPDATE data_requests
SET export_revoked_at = COALESCE(export_revoked_at, now()), updated_at = now()
WHERE kind = 'export' AND status = 'completed' AND export_object_generation IS NULL
  AND export_object_key IS NOT NULL;
UPDATE data_requests
SET export_revocation_required = false
WHERE kind = 'deletion' AND status = 'completed';

ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_export_generation;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_export_generation
  CHECK (export_object_generation IS NULL OR export_object_generation ~ '^[0-9]+$');
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_export_revocation;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_export_revocation
  CHECK (export_revoked_at IS NULL OR (kind = 'export' AND export_object_key IS NOT NULL));

ALTER TABLE data_request_evidence DROP CONSTRAINT IF EXISTS data_request_evidence_step_check;
ALTER TABLE data_request_evidence DROP CONSTRAINT IF EXISTS ck_data_request_evidence_step;
ALTER TABLE data_request_evidence ADD CONSTRAINT ck_data_request_evidence_step CHECK(step IN (
  'requested','processing_started','export_snapshot','export_stored','export_objects_revoked',
  'access_revoked','external_accounts_erased','internal_data_erased','completed'
));

CREATE TABLE IF NOT EXISTS data_request_export_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES data_requests(id) ON DELETE RESTRICT,
  subject_hash text NOT NULL CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK(event_type IN ('accessed','revoked','expired_denied')),
  object_generation text NOT NULL CHECK(object_generation ~ '^[0-9]+$'),
  byte_start bigint,
  byte_end bigint,
  size_bytes bigint,
  request_correlation_id text NOT NULL CHECK(length(request_correlation_id) BETWEEN 8 AND 128),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'accessed' AND byte_start IS NOT NULL AND byte_end IS NOT NULL
      AND size_bytes IS NOT NULL AND byte_start >= 0 AND byte_end >= byte_start
      AND size_bytes = byte_end - byte_start + 1)
    OR
    (event_type IN ('revoked','expired_denied') AND byte_start IS NULL
      AND byte_end IS NULL AND size_bytes IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_data_request_export_access_request_time
  ON data_request_export_access_events(request_id, recorded_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_request_export_terminal_event
  ON data_request_export_access_events(request_id, event_type)
  WHERE event_type IN ('revoked','expired_denied');

CREATE OR REPLACE FUNCTION protect_data_request_export_access_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'export access evidence is immutable'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM data_requests WHERE id = OLD.request_id) THEN
    RAISE EXCEPTION 'export access evidence requires parent deletion in the same transaction'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_export_access_event_update ON data_request_export_access_events;
CREATE TRIGGER trg_protect_export_access_event_update
BEFORE UPDATE ON data_request_export_access_events
FOR EACH ROW EXECUTE FUNCTION protect_data_request_export_access_event();

DROP TRIGGER IF EXISTS trg_protect_export_access_event_delete ON data_request_export_access_events;
CREATE CONSTRAINT TRIGGER trg_protect_export_access_event_delete
AFTER DELETE ON data_request_export_access_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION protect_data_request_export_access_event();

CREATE OR REPLACE FUNCTION enforce_data_request_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM data_request_evidence e
      WHERE e.request_id = NEW.id AND e.step = 'completed'
    ) THEN
      RAISE EXCEPTION 'DSR completion evidence is missing' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'export' THEN
      IF NEW.export_checksum_sha256 IS NULL OR NEW.export_size_bytes IS NULL
         OR NEW.export_object_key IS NULL
         OR (NEW.export_object_generation IS NULL AND NEW.export_revoked_at IS NULL)
         OR NEW.export_expires_at IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM data_request_evidence e
           WHERE e.request_id = NEW.id AND e.step = 'export_stored'
         ) THEN
        RAISE EXCEPTION 'export DSR evidence is incomplete' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.kind = 'deletion' THEN
      IF NEW.retention_policy_id IS NULL OR NEW.retention_policy_sha256 IS NULL
         OR (NEW.export_revocation_required AND NOT EXISTS (
           SELECT 1 FROM data_request_evidence e
           WHERE e.request_id = NEW.id AND e.step = 'export_objects_revoked'
         ))
         OR NOT EXISTS (
           SELECT 1 FROM data_request_evidence e
           WHERE e.request_id = NEW.id AND e.step = 'access_revoked'
         )
         OR NOT EXISTS (
           SELECT 1 FROM data_request_evidence e
           WHERE e.request_id = NEW.id AND e.step = 'external_accounts_erased'
         )
         OR NOT EXISTS (
           SELECT 1 FROM data_request_evidence e
           WHERE e.request_id = NEW.id AND e.step = 'internal_data_erased'
         ) THEN
        RAISE EXCEPTION 'deletion DSR evidence is incomplete' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0009_privacy_export_delivery', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
