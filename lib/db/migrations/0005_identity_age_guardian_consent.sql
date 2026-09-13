-- Expand-safe identity, age-band, guardian and legal acknowledgement package.
-- No date of birth or guardian e-mail is collected by this schema.

ALTER TABLE guardian_links ALTER COLUMN guardian_email_hash DROP NOT NULL;

ALTER TABLE consents ADD COLUMN IF NOT EXISTS actor_role text;
UPDATE consents SET actor_role = CASE
  WHEN actor_user_id IS NULL THEN 'system'
  WHEN actor_user_id = user_id THEN 'self'
  ELSE 'guardian'
END
WHERE actor_role IS NULL;
ALTER TABLE consents ALTER COLUMN actor_role SET DEFAULT 'self';
ALTER TABLE consents ALTER COLUMN actor_role SET NOT NULL;

ALTER TABLE consents ADD COLUMN IF NOT EXISTS policy_version text;
UPDATE consents SET policy_version = 'legacy' WHERE policy_version IS NULL;
ALTER TABLE consents ALTER COLUMN policy_version SET DEFAULT 'legacy';
ALTER TABLE consents ALTER COLUMN policy_version SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE consents ADD CONSTRAINT ck_consent_actor_role
    CHECK (actor_role IN ('self','guardian','system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE guardian_links ADD CONSTRAINT ck_guardian_not_minor
    CHECK (guardian_user_id IS NULL OR guardian_user_id <> minor_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_consents_user_kind_recorded
  ON consents(user_id, kind, recorded_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS guardian_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  accepted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_guardian_invitation_digest CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_guardian_invitation_expiry CHECK (expires_at > created_at),
  -- ON DELETE SET NULL must remain possible for a deleted/anonymized guardian.
  CONSTRAINT ck_guardian_invitation_use_actor CHECK (accepted_by_user_id IS NULL OR used_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_invitation_digest
  ON guardian_invitations(token_digest);
CREATE INDEX IF NOT EXISTS idx_guardian_invitation_minor_created
  ON guardian_invitations(minor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_operations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  request_hash text NOT NULL,
  resource_id text,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, idempotency_key),
  CONSTRAINT ck_identity_operation_idempotency_key CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_identity_operation_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$')
);

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0005_identity_age_guardian_consent', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
