-- Additive DSR state machine. This migration intentionally does not approve a
-- retention policy or close DSR-001; those approvals are runtime gates.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS subject_hash text;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'requested';
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 1;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_checksum_sha256 text;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_size_bytes bigint;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_object_key text;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS export_expires_at timestamptz;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS retention_policy_id text;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS retention_policy_sha256 text;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS error_code text;

UPDATE data_requests
SET subject_hash = encode(digest(user_id::text, 'sha256'), 'hex')
WHERE subject_hash IS NULL AND user_id IS NOT NULL;
UPDATE data_requests
SET phase = CASE WHEN status = 'completed' THEN 'completed' ELSE 'requested' END,
    state_version = GREATEST(state_version, 1),
    updated_at = COALESCE(completed_at, requested_at, now())
WHERE phase IS NULL OR phase = 'requested';

ALTER TABLE data_requests ALTER COLUMN subject_hash SET NOT NULL;
ALTER TABLE data_requests ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS data_requests_user_id_fkey;
ALTER TABLE data_requests
  ADD CONSTRAINT data_requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_status;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_status
  CHECK (status IN ('pending','processing','completed','failed'));
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_phase;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_phase CHECK (phase IN (
  'requested','export_snapshot','export_stored','access_revoked',
  'external_accounts_erased','internal_data_erased','completed'
));
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_state_version;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_state_version CHECK (state_version > 0);
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_subject_hash;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_subject_hash
  CHECK (subject_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_export_checksum;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_export_checksum
  CHECK (export_checksum_sha256 IS NULL OR export_checksum_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_retention_checksum;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_retention_checksum
  CHECK (retention_policy_sha256 IS NULL OR retention_policy_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_export_size;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_export_size
  CHECK (export_size_bytes IS NULL OR export_size_bytes >= 0);
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS ck_data_request_completed_shape;
ALTER TABLE data_requests ADD CONSTRAINT ck_data_request_completed_shape CHECK (
  status <> 'completed' OR (phase = 'completed' AND completed_at IS NOT NULL AND error_code IS NULL)
);

DROP INDEX IF EXISTS uq_data_requests_active_user_kind;
DROP INDEX IF EXISTS uq_data_requests_active_user;
CREATE UNIQUE INDEX uq_data_requests_active_user
  ON data_requests(user_id)
  WHERE user_id IS NOT NULL AND status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_data_requests_subject_hash ON data_requests(subject_hash, requested_at DESC);

CREATE TABLE IF NOT EXISTS data_request_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES data_requests(id) ON DELETE RESTRICT,
  step text NOT NULL CHECK(step IN (
    'requested','processing_started','export_snapshot','export_stored',
    'access_revoked','external_accounts_erased','internal_data_erased','completed'
  )),
  idempotency_key text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, step),
  UNIQUE(request_id, idempotency_key),
  CHECK(length(idempotency_key) BETWEEN 8 AND 160)
);
CREATE INDEX IF NOT EXISTS idx_data_request_evidence_request_time
  ON data_request_evidence(request_id, recorded_at, id);

CREATE OR REPLACE FUNCTION enforce_data_request_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Validate every completed shape, including direct INSERTs and later
  -- UPDATEs. Limiting this to the first status transition allowed a caller to
  -- insert a completed row or remove evidence after completion.
  IF NEW.status = 'completed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM data_request_evidence e
      WHERE e.request_id = NEW.id AND e.step = 'completed'
    ) THEN
      RAISE EXCEPTION 'DSR completion evidence is missing' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'export' THEN
      IF NEW.export_checksum_sha256 IS NULL OR NEW.export_size_bytes IS NULL
         OR NEW.export_object_key IS NULL OR NEW.export_expires_at IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM data_request_evidence e
           WHERE e.request_id = NEW.id AND e.step = 'export_stored'
         ) THEN
        RAISE EXCEPTION 'export DSR evidence is incomplete' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.kind = 'deletion' THEN
      IF NEW.retention_policy_id IS NULL OR NEW.retention_policy_sha256 IS NULL
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

DROP TRIGGER IF EXISTS trg_enforce_data_request_completion ON data_requests;
CREATE TRIGGER trg_enforce_data_request_completion
BEFORE INSERT OR UPDATE ON data_requests
FOR EACH ROW EXECUTE FUNCTION enforce_data_request_completion();

-- Evidence is append-only while its parent request exists. A deferred delete
-- check still permits the approved retention job to delete evidence and then
-- its parent request in the same transaction.
CREATE OR REPLACE FUNCTION protect_data_request_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'data request evidence is immutable' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM data_requests WHERE id = OLD.request_id) THEN
    RAISE EXCEPTION 'data request evidence requires parent deletion in the same transaction'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_data_request_evidence_update ON data_request_evidence;
CREATE TRIGGER trg_protect_data_request_evidence_update
BEFORE UPDATE ON data_request_evidence
FOR EACH ROW EXECUTE FUNCTION protect_data_request_evidence();

DROP TRIGGER IF EXISTS trg_protect_data_request_evidence_delete ON data_request_evidence;
CREATE CONSTRAINT TRIGGER trg_protect_data_request_evidence_delete
AFTER DELETE ON data_request_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION protect_data_request_evidence();

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0008_privacy_dsr_state_machine', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
