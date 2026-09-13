-- Runtime eligibility metadata for simulation selection. Existing rows remain
-- deliberately blocked: permissions=[], author_id=NULL, transformation=NULL
-- and presentation_kind='blocked_unclassified'. No migration infers rights.
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE licenses
  DROP CONSTRAINT IF EXISTS ck_license_permissions;
ALTER TABLE licenses
  ADD CONSTRAINT ck_license_permissions CHECK (
    jsonb_typeof(permissions) = 'array'
    AND permissions <@ '["commercial","digital","reproduce","adapt","fragment"]'::jsonb
  );

ALTER TABLE question_items
  ADD COLUMN IF NOT EXISTS author_id text,
  ADD COLUMN IF NOT EXISTS source_transformation text;

ALTER TABLE question_items
  DROP CONSTRAINT IF EXISTS ck_question_item_source_transformation;
ALTER TABLE question_items
  ADD CONSTRAINT ck_question_item_source_transformation CHECK (
    source_transformation IS NULL
    OR (origin = 'original_authoral' AND source_transformation = 'original')
    OR (origin = 'official_licensed' AND source_transformation IN ('verbatim','adapted','fragmented'))
  );

ALTER TABLE question_versions
  ADD COLUMN IF NOT EXISTS presentation_kind text NOT NULL DEFAULT 'blocked_unclassified';

ALTER TABLE question_versions
  DROP CONSTRAINT IF EXISTS ck_question_version_presentation_kind;
ALTER TABLE question_versions
  ADD CONSTRAINT ck_question_version_presentation_kind CHECK (
    presentation_kind IN ('blocked_unclassified','text_only','external_assets')
  );

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0013_simulation_editorial_eligibility', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
