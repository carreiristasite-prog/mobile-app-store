-- Additive Phase A foundation for app/request integrity. No provider adapter in
-- this migration or release is allowed to create server_verified evidence.
-- Raw nonces, bearer tokens, assertions and receipts never enter public rows.

CREATE TABLE IF NOT EXISTS integrity_device_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_digest text NOT NULL CHECK(installation_digest ~ '^[a-f0-9]{64}$'),
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  environment text NOT NULL CHECK(environment IN ('development','production')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_integrity_device_revocation CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_device_owner_installation
  ON integrity_device_bindings(user_id, installation_digest, platform, environment);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_device_scope
  ON integrity_device_bindings(id, user_id, platform, environment);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_device_owner_environment
  ON integrity_device_bindings(id, user_id, environment);
CREATE INDEX IF NOT EXISTS idx_integrity_device_owner_status
  ON integrity_device_bindings(user_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS app_integrity_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_binding_id uuid NOT NULL REFERENCES integrity_device_bindings(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'ios' CHECK(platform = 'ios'),
  environment text NOT NULL CHECK(environment IN ('development','production')),
  key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z0-9_-]{43}$'),
  key_id_hash text NOT NULL CHECK(key_id_hash ~ '^[a-f0-9]{64}$'),
  public_key_spki bytea,
  format_policy text CHECK(format_policy IN (
    'apple_appattest_legacy_v1','apple_appattest_extensions_v2'
  )),
  receipt_ciphertext bytea,
  receipt_key_version text,
  app_id_prefix text,
  bundle_id text,
  bundle_version text,
  aaguid_environment text,
  validation_category integer,
  last_assertion_counter bigint NOT NULL DEFAULT 0 CHECK(last_assertion_counter >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','active','revoked','lost','compromised')),
  attested_at timestamptz,
  last_asserted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_app_integrity_key_receipt_pair CHECK (
    (receipt_ciphertext IS NULL) = (receipt_key_version IS NULL)
  ),
  CONSTRAINT ck_app_integrity_key_active_shape CHECK (
    status <> 'active' OR (
      public_key_spki IS NOT NULL AND format_policy IS NOT NULL
      AND receipt_ciphertext IS NOT NULL AND receipt_key_version IS NOT NULL
      AND app_id_prefix IS NOT NULL AND bundle_id IS NOT NULL
      AND bundle_version IS NOT NULL AND aaguid_environment IS NOT NULL
      AND attested_at IS NOT NULL
    )
  ),
  CONSTRAINT ck_app_integrity_key_revocation CHECK (
    status NOT IN ('revoked','lost','compromised') OR revoked_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_integrity_key_environment_hash
  ON app_integrity_keys(environment, key_id_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_integrity_key_owner_device
  ON app_integrity_keys(user_id, device_binding_id, key_id_hash);
CREATE INDEX IF NOT EXISTS idx_app_integrity_key_owner_status
  ON app_integrity_keys(user_id, status, updated_at DESC);
ALTER TABLE app_integrity_keys ADD CONSTRAINT app_integrity_keys_owner_device_fkey
  FOREIGN KEY(device_binding_id, user_id, platform, environment)
  REFERENCES integrity_device_bindings(id, user_id, platform, environment) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS integrity_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_binding_id uuid NOT NULL REFERENCES integrity_device_bindings(id) ON DELETE CASCADE,
  auth_session_hash text NOT NULL CHECK(auth_session_hash ~ '^[a-f0-9]{64}$'),
  purpose text NOT NULL CHECK(purpose IN ('platform_age_signal','apple_key_attestation')),
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  environment text NOT NULL CHECK(environment IN ('development','production')),
  apple_key_id_hash text CHECK(apple_key_id_hash ~ '^[a-f0-9]{64}$'),
  nonce_hash text NOT NULL CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
  principal_binding_hash text NOT NULL CHECK(principal_binding_hash ~ '^[a-f0-9]{64}$'),
  principal_binding_key_version text NOT NULL
    CHECK(length(principal_binding_key_version) BETWEEN 1 AND 64
      AND principal_binding_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  canonicalization_version text NOT NULL CHECK(canonicalization_version = 'age-integrity-v1'),
  status text NOT NULL DEFAULT 'issued'
    CHECK(status IN ('issued','verifying','consumed','rejected','expired','indeterminate')),
  proof_digest text CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  request_digest text CHECK(request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  idempotency_key text CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  verification_attempt_id uuid,
  lease_generation integer NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  proof_ciphertext bytea,
  proof_key_version text,
  proof_delete_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  consumed_at timestamptz,
  terminal_at timestamptz,
  failure_code text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  CONSTRAINT ck_integrity_challenge_expiry CHECK(expires_at > issued_at),
  CONSTRAINT ck_integrity_challenge_apple_key CHECK (
    (platform = 'ios' AND apple_key_id_hash IS NOT NULL)
    OR (platform = 'android' AND apple_key_id_hash IS NULL)
  ),
  CONSTRAINT ck_integrity_challenge_purpose_platform CHECK (
    purpose = 'platform_age_signal'
    OR (purpose = 'apple_key_attestation' AND platform = 'ios')
  ),
  CONSTRAINT ck_integrity_challenge_proof_ciphertext CHECK (
    (proof_ciphertext IS NULL AND proof_key_version IS NULL AND proof_delete_at IS NULL)
    OR (
      platform = 'android' AND reserved_at IS NOT NULL AND proof_ciphertext IS NOT NULL
      AND proof_key_version IS NOT NULL AND proof_delete_at IS NOT NULL
      AND proof_delete_at <= reserved_at + interval '5 minutes'
    )
  ),
  CONSTRAINT ck_integrity_challenge_state_shape CHECK (
    (status = 'issued' AND proof_digest IS NULL AND request_digest IS NULL
      AND idempotency_key IS NULL AND verification_attempt_id IS NULL
      AND reserved_at IS NULL AND terminal_at IS NULL)
    OR
    (status = 'verifying' AND proof_digest IS NOT NULL AND request_digest IS NOT NULL
      AND idempotency_key IS NOT NULL AND verification_attempt_id IS NOT NULL
      AND reserved_at IS NOT NULL AND terminal_at IS NULL AND lease_generation >= 1)
    OR
    (status = 'consumed' AND proof_digest IS NOT NULL AND request_digest IS NOT NULL
      AND idempotency_key IS NOT NULL AND verification_attempt_id IS NOT NULL
      AND reserved_at IS NOT NULL AND consumed_at IS NOT NULL AND terminal_at IS NOT NULL)
    OR
    (status IN ('rejected','indeterminate') AND proof_digest IS NOT NULL
      AND request_digest IS NOT NULL AND idempotency_key IS NOT NULL
      AND verification_attempt_id IS NOT NULL AND reserved_at IS NOT NULL
      AND terminal_at IS NOT NULL AND failure_code IS NOT NULL)
    OR
    (status = 'expired' AND terminal_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_integrity_challenge_owner_status
  ON integrity_challenges(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_integrity_challenge_device_status
  ON integrity_challenges(device_binding_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_challenge_owner_idempotency
  ON integrity_challenges(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_challenge_proof_digest
  ON integrity_challenges(proof_digest) WHERE proof_digest IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_challenge_scope
  ON integrity_challenges(id, user_id, device_binding_id, platform, environment);
ALTER TABLE integrity_challenges ADD CONSTRAINT integrity_challenges_owner_device_fkey
  FOREIGN KEY(device_binding_id, user_id, platform, environment)
  REFERENCES integrity_device_bindings(id, user_id, platform, environment) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS integrity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_binding_id uuid NOT NULL REFERENCES integrity_device_bindings(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES integrity_challenges(id) ON DELETE CASCADE,
  provider text NOT NULL
    CHECK(provider IN ('apple_app_attest','google_play_integrity_standard')),
  purpose text NOT NULL CHECK(purpose = 'platform_age_signal'),
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  environment text NOT NULL CHECK(environment IN ('development','production')),
  status text NOT NULL CHECK(status IN ('verifying','verified','rejected','expired','indeterminate')),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  envelope_digest text NOT NULL CHECK(envelope_digest ~ '^[a-f0-9]{64}$'),
  request_digest text NOT NULL CHECK(request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  proof_digest text NOT NULL CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  outcome_code text,
  app_build_decision text NOT NULL DEFAULT 'not_evaluated',
  device_decision text NOT NULL DEFAULT 'not_evaluated',
  testing_response boolean,
  policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 80
    AND policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  issued_at timestamptz NOT NULL,
  verified_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_integrity_verification_state_shape CHECK (
    (status = 'verifying' AND terminal_at IS NULL AND verified_at IS NULL)
    OR (status = 'verified' AND terminal_at IS NOT NULL AND verified_at IS NOT NULL
      AND outcome_code = 'verified')
    OR (status IN ('rejected','expired','indeterminate') AND terminal_at IS NOT NULL
      AND verified_at IS NULL AND outcome_code IS NOT NULL)
  ),
  CONSTRAINT ck_integrity_verification_provider_platform CHECK (
    (provider = 'apple_app_attest' AND platform = 'ios')
    OR (provider = 'google_play_integrity_standard' AND platform = 'android')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_verification_challenge
  ON integrity_verifications(challenge_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_verification_owner_idempotency
  ON integrity_verifications(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_integrity_verification_owner_created
  ON integrity_verifications(user_id, created_at DESC);
ALTER TABLE integrity_verifications ADD CONSTRAINT integrity_verifications_owner_challenge_fkey
  FOREIGN KEY(challenge_id, user_id, device_binding_id, platform, environment)
  REFERENCES integrity_challenges(id, user_id, device_binding_id, platform, environment)
  ON DELETE CASCADE;

ALTER TABLE integrity_challenges
  ADD CONSTRAINT integrity_challenges_verification_attempt_fkey
  FOREIGN KEY(verification_attempt_id) REFERENCES integrity_verifications(id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS verification_id uuid;
ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS assurance_kind text;
ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS verified_build text;
ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS verification_policy_version text;
ALTER TABLE platform_age_signals ADD COLUMN IF NOT EXISTS pending_conflict jsonb;

ALTER TABLE platform_age_signals
  ADD CONSTRAINT platform_age_signals_verification_id_fkey
  FOREIGN KEY(verification_id) REFERENCES integrity_verifications(id) ON DELETE SET NULL;

-- No historical server_verified row was produced by the reviewed verifier.
-- Downgrade unverifiable legacy trust instead of grandfathering it.
UPDATE platform_age_signals
SET trust_status = 'device_reported_monitoring'
WHERE trust_status = 'server_verified' AND verification_id IS NULL;

ALTER TABLE platform_age_signals ADD CONSTRAINT ck_platform_age_signal_assurance
  CHECK(assurance_kind IS NULL OR assurance_kind = 'integrity_bound_report');
ALTER TABLE platform_age_signals ADD CONSTRAINT ck_platform_age_signal_verified_shape CHECK (
  (trust_status = 'device_reported_monitoring' AND verification_id IS NULL
    AND assurance_kind IS NULL AND verified_at IS NULL AND expires_at IS NULL
    AND verified_build IS NULL AND verification_policy_version IS NULL)
  OR
  (trust_status = 'server_verified' AND verification_id IS NOT NULL
    AND assurance_kind = 'integrity_bound_report' AND verified_at IS NOT NULL
    AND expires_at > verified_at AND verified_build IS NOT NULL
    AND verification_policy_version IS NOT NULL)
);
ALTER TABLE platform_age_signals ADD CONSTRAINT ck_platform_age_signal_pending_conflict CHECK (
  pending_conflict IS NULL OR (
    jsonb_typeof(pending_conflict) = 'object'
    AND pending_conflict ?& array['status','ageBand','observedAt']
    AND (pending_conflict - 'status' - 'ageBand' - 'observedAt') = '{}'::jsonb
    AND pending_conflict->>'status' IN (
      'shared','not_shared','verification_required','not_required','unsupported','error'
    )
    AND (
      (pending_conflict->>'status' = 'shared'
        AND pending_conflict->>'ageBand' IN ('under_13','13_15','16_17','18_plus'))
      OR (pending_conflict->>'status' <> 'shared' AND pending_conflict->'ageBand' = 'null'::jsonb)
    )
  )
);

-- Phase A deliberately has no cryptographic provider verifier. Keep the
-- future-compatible columns, but make privilege elevation impossible at the
-- database boundary until a later, independently reviewed migration replaces
-- this trigger after real Apple/Google homologation.
CREATE OR REPLACE FUNCTION enforce_phase_a_platform_age_monitoring_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trust_status = 'server_verified' THEN
    RAISE EXCEPTION 'server_verified_is_disabled_in_app_integrity_phase_a'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_phase_a_platform_age_monitoring_only
BEFORE INSERT OR UPDATE OF trust_status, verification_id, assurance_kind,
  verified_at, expires_at, verified_build, verification_policy_version
ON platform_age_signals
FOR EACH ROW EXECUTE FUNCTION enforce_phase_a_platform_age_monitoring_only();

CREATE OR REPLACE FUNCTION protect_integrity_challenge_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.user_id, NEW.device_binding_id, NEW.auth_session_hash, NEW.purpose,
         NEW.platform, NEW.environment, NEW.apple_key_id_hash, NEW.nonce_hash,
         NEW.principal_binding_hash, NEW.principal_binding_key_version,
         NEW.canonicalization_version, NEW.issued_at, NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.user_id, OLD.device_binding_id, OLD.auth_session_hash, OLD.purpose,
         OLD.platform, OLD.environment, OLD.apple_key_id_hash, OLD.nonce_hash,
         OLD.principal_binding_hash, OLD.principal_binding_key_version,
         OLD.canonicalization_version, OLD.issued_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'integrity_challenge_binding_is_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('consumed','rejected','expired','indeterminate') THEN
    RAISE EXCEPTION 'integrity_challenge_terminal_is_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'issued' AND NEW.status IN ('verifying','expired','rejected'))
    OR (OLD.status = 'verifying' AND NEW.status IN ('consumed','rejected','expired','indeterminate'))
  ) THEN
    RAISE EXCEPTION 'integrity_challenge_state_transition_rejected'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_integrity_challenge_binding
BEFORE UPDATE ON integrity_challenges
FOR EACH ROW EXECUTE FUNCTION protect_integrity_challenge_binding();

CREATE OR REPLACE FUNCTION protect_app_integrity_key_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.user_id, NEW.device_binding_id, NEW.platform, NEW.environment, NEW.key_id, NEW.key_id_hash)
     IS DISTINCT FROM ROW(OLD.user_id, OLD.device_binding_id, OLD.platform, OLD.environment, OLD.key_id, OLD.key_id_hash) THEN
    RAISE EXCEPTION 'app_integrity_key_binding_is_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('revoked','lost','compromised') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'app_integrity_key_terminal_is_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_app_integrity_key_binding
BEFORE UPDATE ON app_integrity_keys
FOR EACH ROW EXECUTE FUNCTION protect_app_integrity_key_binding();

CREATE OR REPLACE FUNCTION protect_integrity_verification_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.user_id, NEW.device_binding_id, NEW.challenge_id, NEW.provider,
         NEW.purpose, NEW.environment, NEW.idempotency_key, NEW.envelope_digest,
         NEW.request_digest, NEW.proof_digest, NEW.policy_version, NEW.issued_at)
     IS DISTINCT FROM
     ROW(OLD.user_id, OLD.device_binding_id, OLD.challenge_id, OLD.provider,
         OLD.purpose, OLD.environment, OLD.idempotency_key, OLD.envelope_digest,
         OLD.request_digest, OLD.proof_digest, OLD.policy_version, OLD.issued_at) THEN
    RAISE EXCEPTION 'integrity_verification_binding_is_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'verifying' THEN
    RAISE EXCEPTION 'integrity_verification_terminal_is_immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NEW.status NOT IN ('verified','rejected','expired','indeterminate') THEN
    RAISE EXCEPTION 'integrity_verification_state_transition_rejected'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_integrity_verification_binding
BEFORE UPDATE ON integrity_verifications
FOR EACH ROW EXECUTE FUNCTION protect_integrity_verification_binding();

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0014_app_integrity_phase_a', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
