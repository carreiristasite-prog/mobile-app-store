-- RevenueCat billing identity and lifecycle hardening. This migration is
-- additive: existing users receive a dedicated, random App User ID while the
-- former internal/Clerk identifiers remain explicit transition aliases.

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_billing_customer_revocation CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

INSERT INTO billing_customers(user_id)
SELECT id FROM users
ON CONFLICT(user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS billing_customer_aliases (
  alias text PRIMARY KEY CHECK(length(alias) BETWEEN 1 AND 100),
  user_id uuid NOT NULL REFERENCES billing_customers(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('canonical','legacy_internal','legacy_clerk','revenuecat_alias')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_alias_user ON billing_customer_aliases(user_id);

INSERT INTO billing_customer_aliases(alias, user_id, kind)
SELECT app_user_id::text, user_id, 'canonical' FROM billing_customers
ON CONFLICT(alias) DO NOTHING;
INSERT INTO billing_customer_aliases(alias, user_id, kind)
SELECT id::text, id, 'legacy_internal' FROM users
ON CONFLICT(alias) DO NOTHING;
INSERT INTO billing_customer_aliases(alias, user_id, kind)
SELECT subject, user_id, 'legacy_clerk'
FROM auth_identities
WHERE provider = 'clerk' AND length(subject) BETWEEN 1 AND 100
ON CONFLICT(alias) DO NOTHING;

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'revenuecat';
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production';
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 1;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS grace_period_expires_at timestamptz;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS auto_resume_at timestamptz;

-- Normalize values written by the pre-0015 API/worker before adding strict
-- checks. No access is broadened: incomplete grace/pause rows are expired.
UPDATE entitlements SET store = CASE lower(store)
  WHEN 'app_store' THEN 'APP_STORE'
  WHEN 'ios' THEN 'APP_STORE'
  WHEN 'play_store' THEN 'PLAY_STORE'
  WHEN 'google_play' THEN 'PLAY_STORE'
  WHEN 'revenuecat' THEN 'REVENUECAT'
  ELSE store
END;
UPDATE entitlements SET product_sku = 'iaaprova.pro.monthly:monthly-auto-renewing'
WHERE store = 'PLAY_STORE' AND product_sku = 'iaaprova.pro.monthly';
UPDATE entitlements SET status = 'inactive', store = 'REVENUECAT',
  product_sku = 'iaaprova.pro.monthly', expires_at = NULL
WHERE store NOT IN ('APP_STORE','PLAY_STORE','REVENUECAT')
   OR product_sku NOT IN ('iaaprova.pro.monthly','iaaprova.pro.monthly:monthly-auto-renewing')
   OR (store = 'APP_STORE' AND product_sku <> 'iaaprova.pro.monthly')
   OR (store = 'PLAY_STORE' AND product_sku <> 'iaaprova.pro.monthly:monthly-auto-renewing');
UPDATE entitlements SET grace_period_expires_at = expires_at
WHERE status = 'grace_period' AND grace_period_expires_at IS NULL AND expires_at IS NOT NULL;
UPDATE entitlements SET status = 'expired'
WHERE (status = 'grace_period' AND grace_period_expires_at IS NULL)
   OR (status = 'paused' AND auto_resume_at IS NULL)
   OR (status = 'active' AND expires_at IS NULL);

ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_key;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_key CHECK(key = 'pro');
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_status;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_status
  CHECK(status IN ('active','grace_period','paused','expired','revoked','inactive'));
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_product;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_product CHECK(
  product_sku IN ('iaaprova.pro.monthly','iaaprova.pro.monthly:monthly-auto-renewing')
);
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_store;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_store
  CHECK(store IN ('APP_STORE','PLAY_STORE','REVENUECAT'));
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_provider;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_provider CHECK(provider = 'revenuecat');
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_environment;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_environment
  CHECK(environment IN ('production','sandbox'));
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_lifecycle;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_lifecycle CHECK(
  lifecycle_version = 1
  AND (status <> 'grace_period' OR grace_period_expires_at IS NOT NULL)
  AND (status <> 'paused' OR auto_resume_at IS NOT NULL)
  AND (status <> 'active' OR expires_at IS NOT NULL)
  AND (status = 'grace_period' OR grace_period_expires_at IS NULL)
  AND (status = 'paused' OR auto_resume_at IS NULL)
  AND (store <> 'APP_STORE' OR product_sku = 'iaaprova.pro.monthly')
  AND (store <> 'PLAY_STORE' OR product_sku = 'iaaprova.pro.monthly:monthly-auto-renewing')
);
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS ck_entitlement_text_bounds;
ALTER TABLE entitlements ADD CONSTRAINT ck_entitlement_text_bounds CHECK(
  length(source_event_id) BETWEEN 1 AND 255
  AND (original_transaction_id IS NULL OR length(original_transaction_id) BETWEEN 1 AND 255)
);

ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production';
ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS store text;
UPDATE subscription_events SET type = upper(type);
UPDATE subscription_events SET store = CASE lower(store)
  WHEN 'app_store' THEN 'APP_STORE'
  WHEN 'ios' THEN 'APP_STORE'
  WHEN 'play_store' THEN 'PLAY_STORE'
  WHEN 'google_play' THEN 'PLAY_STORE'
  ELSE store
END WHERE store IS NOT NULL;
UPDATE subscription_events SET store = NULL
WHERE store IS NOT NULL AND store NOT IN ('APP_STORE','PLAY_STORE');
UPDATE subscription_events SET type = 'EXPIRATION'
WHERE type NOT IN (
  'INITIAL_PURCHASE','RENEWAL','CANCELLATION','UNCANCELLATION','NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED','EXPIRATION','BILLING_ISSUE','PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED','REFUND','REFUND_REVERSED','TRANSFER',
  'TEMPORARY_ENTITLEMENT_GRANT'
);
ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS ck_subscription_event_schema;
ALTER TABLE subscription_events ADD CONSTRAINT ck_subscription_event_schema CHECK(schema_version = 1);
ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS ck_subscription_event_environment;
ALTER TABLE subscription_events ADD CONSTRAINT ck_subscription_event_environment
  CHECK(environment IN ('production','sandbox'));
ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS ck_subscription_event_store;
ALTER TABLE subscription_events ADD CONSTRAINT ck_subscription_event_store
  CHECK(store IS NULL OR store IN ('APP_STORE','PLAY_STORE'));
ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS ck_subscription_event_type;
ALTER TABLE subscription_events ADD CONSTRAINT ck_subscription_event_type CHECK(type IN (
  'INITIAL_PURCHASE','RENEWAL','CANCELLATION','UNCANCELLATION','NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED','EXPIRATION','BILLING_ISSUE','PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED','REFUND','REFUND_REVERSED','TRANSFER',
  'TEMPORARY_ENTITLEMENT_GRANT'
));
ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS ck_subscription_event_payload;
ALTER TABLE subscription_events ADD CONSTRAINT ck_subscription_event_payload CHECK(
  length(provider_event_id) BETWEEN 1 AND 255 AND jsonb_typeof(payload) = 'object'
);

ALTER TABLE webhook_inbox DROP CONSTRAINT IF EXISTS ck_webhook_provider;
ALTER TABLE webhook_inbox ADD CONSTRAINT ck_webhook_provider CHECK(provider = 'revenuecat');
ALTER TABLE webhook_inbox DROP CONSTRAINT IF EXISTS ck_webhook_status;
ALTER TABLE webhook_inbox ADD CONSTRAINT ck_webhook_status
  CHECK(status IN ('received','processing','processed','stale','ignored','rejected','error'));
ALTER TABLE webhook_inbox DROP CONSTRAINT IF EXISTS ck_webhook_payload;
ALTER TABLE webhook_inbox ADD CONSTRAINT ck_webhook_payload CHECK(
  length(event_id) BETWEEN 1 AND 255 AND jsonb_typeof(payload) = 'object'
  AND (error IS NULL OR length(error) BETWEEN 1 AND 255)
);

ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS run_date date;
UPDATE reconciliation_runs SET run_date = started_at::date WHERE run_date IS NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN run_date SET NOT NULL;
ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS cursor_user_id uuid;
ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS snapshot_at timestamptz;
UPDATE reconciliation_runs SET snapshot_at = started_at WHERE snapshot_at IS NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN snapshot_at SET NOT NULL;
ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS cursor_created_at timestamptz;
ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS expected_count integer NOT NULL DEFAULT 0;
ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE reconciliation_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS ck_reconciliation_provider;
ALTER TABLE reconciliation_runs ADD CONSTRAINT ck_reconciliation_provider CHECK(provider = 'revenuecat');
ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS ck_reconciliation_status;
UPDATE reconciliation_runs SET status = CASE lower(status)
  WHEN 'running' THEN 'scheduling'
  WHEN 'pending' THEN 'scheduling'
  WHEN 'processing' THEN 'draining'
  ELSE lower(status)
END;
ALTER TABLE reconciliation_runs ADD CONSTRAINT ck_reconciliation_status
  CHECK(status IN ('scheduling','draining','completed','failed'));
ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS ck_reconciliation_counts;
ALTER TABLE reconciliation_runs ADD CONSTRAINT ck_reconciliation_counts CHECK(
  checked_count >= 0 AND mismatch_count >= 0 AND failed_count >= 0
  AND expected_count >= 0 AND checked_count <= expected_count
  AND mismatch_count <= checked_count AND failed_count <= checked_count
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_provider_day
  ON reconciliation_runs(provider, run_date);

CREATE TABLE IF NOT EXISTS billing_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES billing_customers(user_id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL,
  outbox_event_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
  mismatch boolean NOT NULL DEFAULT false,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, user_id),
  CONSTRAINT ck_billing_reconciliation_terminal CHECK(
    (status = 'pending' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);
ALTER TABLE billing_reconciliation_items DROP CONSTRAINT IF EXISTS ck_billing_reconciliation_error;
ALTER TABLE billing_reconciliation_items ADD CONSTRAINT ck_billing_reconciliation_error
  CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 120);
CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_pending
  ON billing_reconciliation_items(run_id, status, created_at);

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0015_billing_identity_lifecycle', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
