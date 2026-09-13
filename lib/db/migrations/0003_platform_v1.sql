-- IA Aprova platform v1. Additive migration; legacy tables stay readable while
-- the /v1 API moves to UUID domain identities and immutable question versions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
UPDATE users SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE users ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_internal_id ON users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL, subject text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_auth_identity_user ON auth_identities(user_id);
INSERT INTO auth_identities(user_id, provider, subject)
SELECT id, 'clerk', clerk_user_id FROM users ON CONFLICT(provider, subject) DO NOTHING;

CREATE TABLE IF NOT EXISTS age_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_band text NOT NULL CHECK (age_band IN ('under_13','13_15','16_17','18_plus')),
  social_enabled boolean NOT NULL DEFAULT false, notifications_enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guardian_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), minor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_user_id uuid REFERENCES users(id) ON DELETE SET NULL, guardian_email_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','revoked')),
  verified_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guardian_minor ON guardian_links(minor_user_id);
CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL, document_version text NOT NULL, granted boolean NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, recorded_at timestamptz NOT NULL DEFAULT now(), evidence jsonb
);
CREATE INDEX IF NOT EXISTS idx_consents_user_kind ON consents(user_id, kind);
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL UNIQUE, platform text NOT NULL, integrity_state text NOT NULL DEFAULT 'unknown',
  last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS data_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('export','deletion')), status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, failure_reason text
);
CREATE INDEX IF NOT EXISTS idx_data_requests_user_status ON data_requests(user_id, status);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, institution text, category text NOT NULL,
  default_track text, status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_product_selections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id), selected_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exam_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id), code text NOT NULL,
  board text, role text, phase text, modality text, effective_from timestamptz, effective_to timestamptz,
  status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, code)
);
CREATE TABLE IF NOT EXISTS subjects (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id text NOT NULL REFERENCES subjects(id), parent_id uuid REFERENCES topics(id),
  slug text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject_id, slug)
);
CREATE TABLE IF NOT EXISTS blueprint_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_version_id uuid NOT NULL REFERENCES exam_versions(id), version integer NOT NULL CHECK(version > 0),
  status text NOT NULL DEFAULT 'draft', rules jsonb NOT NULL, published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(exam_version_id, version)
);
CREATE TABLE IF NOT EXISTS blueprint_subjects (
  blueprint_version_id uuid NOT NULL REFERENCES blueprint_versions(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES subjects(id), question_count integer NOT NULL CHECK(question_count > 0),
  weight double precision NOT NULL DEFAULT 1 CHECK(weight > 0), PRIMARY KEY(blueprint_version_id, subject_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, title text NOT NULL, owner text, uri text,
  content_hash text NOT NULL UNIQUE, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES sources(id), status text NOT NULL DEFAULT 'pending',
  license_type text NOT NULL, territory text, platforms jsonb, starts_at timestamptz, expires_at timestamptz,
  evidence_hash text, approved_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS question_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_hash text NOT NULL UNIQUE,
  origin text NOT NULL CHECK(origin IN ('original_authoral','official_licensed')),
  source_id uuid REFERENCES sources(id), license_id uuid REFERENCES licenses(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(origin <> 'official_licensed' OR license_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_item_id uuid NOT NULL REFERENCES question_items(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version > 0), exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  subject_id text NOT NULL REFERENCES subjects(id), topic_id uuid NOT NULL REFERENCES topics(id), statement text NOT NULL,
  solution text NOT NULL, difficulty text NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
  skill text NOT NULL, status text NOT NULL DEFAULT 'quarantine', content_hash text NOT NULL, source_page text,
  supersedes_id uuid REFERENCES question_versions(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(question_item_id, version)
);
CREATE INDEX IF NOT EXISTS idx_question_version_catalog ON question_versions(exam_version_id, subject_id, topic_id, status);
CREATE TABLE IF NOT EXISTS question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_version_id uuid NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  key text NOT NULL, body text NOT NULL, is_correct boolean NOT NULL DEFAULT false, rationale text NOT NULL,
  order_index integer NOT NULL CHECK(order_index >= 0), UNIQUE(question_version_id, key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_question_one_correct_option ON question_options(question_version_id) WHERE is_correct;
CREATE TABLE IF NOT EXISTS review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_version_id uuid NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  stage text NOT NULL, reviewer_id text NOT NULL, decision text NOT NULL, findings jsonb, content_hash text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_question_stage ON review_decisions(question_version_id, stage);
CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_version_id uuid NOT NULL REFERENCES question_versions(id),
  blueprint_version_id uuid REFERENCES blueprint_versions(id), status text NOT NULL DEFAULT 'published',
  published_at timestamptz NOT NULL DEFAULT now(), suspended_at timestamptz, reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_question_blueprint ON publications(question_version_id, COALESCE(blueprint_version_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE IF NOT EXISTS learning_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id), exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  blueprint_version_id uuid REFERENCES blueprint_versions(id), mode text NOT NULL,
  algorithm_version text NOT NULL, status text NOT NULL DEFAULT 'active', seed text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_learning_session_user_status ON learning_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_session_user_mode_started ON learning_sessions(user_id, mode, started_at);
CREATE TABLE IF NOT EXISTS item_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_version_id uuid NOT NULL REFERENCES question_versions(id),
  sequence integer NOT NULL CHECK(sequence > 0), selection_bucket text NOT NULL,
  exposed_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz, UNIQUE(session_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_exposure_user_question ON item_exposures(user_id, question_version_id);
CREATE INDEX IF NOT EXISTS idx_exposure_user_exposed_at ON item_exposures(user_id, exposed_at);
CREATE TABLE IF NOT EXISTS attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE, exposure_id uuid NOT NULL UNIQUE REFERENCES item_exposures(id),
  question_version_id uuid NOT NULL REFERENCES question_versions(id), selected_option_id uuid NOT NULL REFERENCES question_options(id),
  is_correct boolean NOT NULL, elapsed_ms integer NOT NULL CHECK(elapsed_ms >= 0), valid_for_calibration boolean NOT NULL,
  mastery_probability double precision NOT NULL CONSTRAINT ck_attempt_mastery_probability CHECK(mastery_probability BETWEEN 0 AND 1),
  mastery_observations integer NOT NULL CONSTRAINT ck_attempt_mastery_observations CHECK(mastery_observations >= 0),
  idempotency_key text NOT NULL, answered_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_attempt_user_answered ON attempts(user_id, answered_at);
CREATE TABLE IF NOT EXISTS topic_mastery (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic_id uuid NOT NULL REFERENCES topics(id),
  probability double precision NOT NULL DEFAULT .35 CHECK(probability BETWEEN 0 AND 1), observations integer NOT NULL DEFAULT 0 CHECK(observations >= 0),
  algorithm_version text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, topic_id)
);
CREATE TABLE IF NOT EXISTS review_schedules (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic_id uuid NOT NULL REFERENCES topics(id),
  due_at timestamptz NOT NULL, interval_days integer NOT NULL DEFAULT 1, ease_factor double precision NOT NULL DEFAULT 2.5,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL, status text NOT NULL, product_sku text NOT NULL, store text NOT NULL, original_transaction_id text,
  starts_at timestamptz NOT NULL, expires_at timestamptz, source_event_id text NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_entitlement_status_expiry ON entitlements(status, expires_at);
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_event_id text NOT NULL UNIQUE, type text NOT NULL, occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_inbox (
  provider text NOT NULL, event_id text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, error text, PRIMARY KEY(provider, event_id)
);
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, status text NOT NULL,
  checked_count integer NOT NULL DEFAULT 0, mismatch_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS social_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, pseudonym text NOT NULL UNIQUE,
  avatar_key text NOT NULL, invite_code text NOT NULL UNIQUE, discoverable boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS friendships (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(requester_id, addressee_id), CHECK(requester_id <> addressee_id)
);
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(blocker_id, blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS duel_matches_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id),
  player_one_id uuid NOT NULL REFERENCES users(id), player_two_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'matched', seed text NOT NULL, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(player_one_id <> player_two_id)
);
CREATE TABLE IF NOT EXISTS ranking_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id), name text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'scheduled', CHECK(ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL, severity text NOT NULL, score double precision NOT NULL, evidence jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL, target_id text NOT NULL, reason text NOT NULL, details text,
  status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_reports_target_status ON reports(target_type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_target_status ON reports(reporter_user_id, target_type, target_id, status);
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_type text NOT NULL, aggregate_id text NOT NULL,
  event_type text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(processed_at, available_at);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_type text NOT NULL, actor_id text, action text NOT NULL,
  resource_type text NOT NULL, resource_id text NOT NULL, request_id text, before jsonb, after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id, created_at);
CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, rules jsonb NOT NULL,
  updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0003_platform_v1', CURRENT_TIMESTAMP) ON CONFLICT(hash) DO NOTHING;
