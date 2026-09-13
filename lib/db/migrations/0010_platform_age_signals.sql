-- Additive, privacy-minimised store age-signal state. No date of birth,
-- Play install ID, parental-control list or raw native payload is retained.
-- Public mobile reports remain monitoring-only until a separately reviewed
-- App Attest / Play Integrity verification path can authenticate them.
CREATE TABLE IF NOT EXISTS platform_age_signals (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK(platform IN ('ios','android')),
  source text NOT NULL CHECK(source IN ('apple_declared_age_range','google_play_age_signals')),
  sharing_status text NOT NULL CHECK(sharing_status IN (
    'shared','not_shared','verification_required','not_required','unsupported','error'
  )),
  age_band text CHECK(age_band IN ('under_13','13_15','16_17','18_plus')),
  trust_status text NOT NULL DEFAULT 'device_reported_monitoring'
    CHECK(trust_status IN ('device_reported_monitoring','server_verified')),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, platform),
  CONSTRAINT ck_platform_age_signal_platform_source CHECK (
    (platform = 'ios' AND source = 'apple_declared_age_range')
    OR (platform = 'android' AND source = 'google_play_age_signals')
  ),
  CONSTRAINT ck_platform_age_signal_shape CHECK (
    (sharing_status = 'shared' AND age_band IS NOT NULL)
    OR (sharing_status <> 'shared' AND age_band IS NULL)
  ),
  CONSTRAINT ck_platform_age_signal_observed_order CHECK(last_observed_at >= first_observed_at)
);

CREATE INDEX IF NOT EXISTS idx_platform_age_signal_user_observed
  ON platform_age_signals(user_id, last_observed_at DESC);

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0010_platform_age_signals', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
