-- Expand-safe binding between a consumed guardian invitation and the exact
-- link/payload created by its first successful acceptance. Existing consumed
-- invitations remain readable, but fail closed for cross-key replay because
-- they do not have cryptographically trustworthy binding metadata.

ALTER TABLE guardian_invitations
  ADD COLUMN IF NOT EXISTS guardian_link_id uuid
    REFERENCES guardian_links(id) ON DELETE SET NULL;

ALTER TABLE guardian_invitations
  ADD COLUMN IF NOT EXISTS acceptance_request_hash text;

DO $$ BEGIN
  ALTER TABLE guardian_invitations
    ADD CONSTRAINT ck_guardian_invitation_acceptance_binding CHECK (
      (guardian_link_id IS NULL AND acceptance_request_hash IS NULL)
      OR (
        used_at IS NOT NULL
        AND acceptance_request_hash ~ '^[a-f0-9]{64}$'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_guardian_invitation_link
  ON guardian_invitations(guardian_link_id)
  WHERE guardian_link_id IS NOT NULL;

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0007_guardian_invitation_replay_binding', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
