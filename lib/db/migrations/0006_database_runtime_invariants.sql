-- Runtime invariants for immutable learning records.
--
-- Editorial drafts remain editable while they have never been published or
-- exposed. Once referenced by a publication/exposure/attempt, core content is
-- frozen and a new question_versions row must be created for corrections.
-- Workflow metadata (status and updated_at) remains mutable. Attempts may be
-- deleted for account/data deletion, but their graded snapshot cannot be
-- rewritten in place.

CREATE TABLE IF NOT EXISTS question_version_freezes (
  question_version_id uuid PRIMARY KEY REFERENCES question_versions(id),
  first_referenced_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'publication_or_exposure'
);

INSERT INTO question_version_freezes(question_version_id, first_referenced_at)
SELECT question_version_id, min(referenced_at)
FROM (
  SELECT question_version_id, published_at AS referenced_at FROM publications
  UNION ALL
  SELECT question_version_id, exposed_at AS referenced_at FROM item_exposures
  UNION ALL
  SELECT question_version_id, answered_at AS referenced_at FROM attempts
) AS historical_references
GROUP BY question_version_id
ON CONFLICT(question_version_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ia_aprova_lock_question_version(target_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ia-aprova-question-version:' || target_id::text, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION ia_aprova_freeze_question_version_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ia_aprova_lock_question_version(NEW.question_version_id);
  INSERT INTO question_version_freezes(question_version_id, reason)
  VALUES (NEW.question_version_id, TG_TABLE_NAME)
  ON CONFLICT(question_version_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publications_freeze_question_version ON publications;
CREATE TRIGGER trg_publications_freeze_question_version
BEFORE INSERT OR UPDATE OF question_version_id ON publications
FOR EACH ROW EXECUTE FUNCTION ia_aprova_freeze_question_version_reference();

DROP TRIGGER IF EXISTS trg_item_exposures_freeze_question_version ON item_exposures;
CREATE TRIGGER trg_item_exposures_freeze_question_version
BEFORE INSERT OR UPDATE OF question_version_id ON item_exposures
FOR EACH ROW EXECUTE FUNCTION ia_aprova_freeze_question_version_reference();

DROP TRIGGER IF EXISTS trg_attempts_freeze_question_version ON attempts;
CREATE TRIGGER trg_attempts_freeze_question_version
BEFORE INSERT OR UPDATE OF question_version_id ON attempts
FOR EACH ROW EXECUTE FUNCTION ia_aprova_freeze_question_version_reference();

CREATE OR REPLACE FUNCTION ia_aprova_guard_question_version_core()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_referenced boolean;
BEGIN
  PERFORM ia_aprova_lock_question_version(OLD.id);
  SELECT EXISTS (
    SELECT 1 FROM question_version_freezes WHERE question_version_id = OLD.id
    UNION ALL
    SELECT 1 FROM publications WHERE question_version_id = OLD.id
    UNION ALL
    SELECT 1 FROM item_exposures WHERE question_version_id = OLD.id
    UNION ALL
    SELECT 1 FROM attempts WHERE question_version_id = OLD.id
  ) INTO is_referenced;

  IF NOT is_referenced THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'question_version_referenced_is_immutable'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.question_item_id, NEW.version, NEW.exam_version_id,
    NEW.subject_id, NEW.topic_id, NEW.statement, NEW.solution,
    NEW.difficulty, NEW.skill, NEW.content_hash, NEW.source_page,
    NEW.supersedes_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.question_item_id, OLD.version, OLD.exam_version_id,
    OLD.subject_id, OLD.topic_id, OLD.statement, OLD.solution,
    OLD.difficulty, OLD.skill, OLD.content_hash, OLD.source_page,
    OLD.supersedes_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'question_version_referenced_core_is_immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_question_versions_guard_core ON question_versions;
CREATE TRIGGER trg_question_versions_guard_core
BEFORE UPDATE OR DELETE ON question_versions
FOR EACH ROW EXECUTE FUNCTION ia_aprova_guard_question_version_core();

CREATE OR REPLACE FUNCTION ia_aprova_guard_question_option()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_id uuid;
  is_referenced boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.question_version_id <> NEW.question_version_id THEN
    -- Stable order prevents two concurrent cross-version moves from taking the
    -- advisory locks in opposite order.
    FOR version_id IN
      SELECT candidate
      FROM (VALUES (OLD.question_version_id), (NEW.question_version_id)) AS ids(candidate)
      ORDER BY candidate
    LOOP
      PERFORM ia_aprova_lock_question_version(version_id);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM ia_aprova_lock_question_version(OLD.question_version_id);
  ELSE
    PERFORM ia_aprova_lock_question_version(NEW.question_version_id);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Both sides matter: otherwise a referenced option could be moved to an
    -- unreferenced draft and silently rewrite the historical answer set.
    SELECT EXISTS (
      SELECT 1 FROM question_version_freezes WHERE question_version_id IN (OLD.question_version_id, NEW.question_version_id)
      UNION ALL
      SELECT 1 FROM publications WHERE question_version_id IN (OLD.question_version_id, NEW.question_version_id)
      UNION ALL
      SELECT 1 FROM item_exposures WHERE question_version_id IN (OLD.question_version_id, NEW.question_version_id)
      UNION ALL
      SELECT 1 FROM attempts WHERE question_version_id IN (OLD.question_version_id, NEW.question_version_id)
    ) INTO is_referenced;
  ELSIF TG_OP = 'DELETE' THEN
    version_id := OLD.question_version_id;
  ELSE
    version_id := NEW.question_version_id;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1 FROM question_version_freezes WHERE question_version_id = version_id
      UNION ALL
      SELECT 1 FROM publications WHERE question_version_id = version_id
      UNION ALL
      SELECT 1 FROM item_exposures WHERE question_version_id = version_id
      UNION ALL
      SELECT 1 FROM attempts WHERE question_version_id = version_id
    ) INTO is_referenced;
  END IF;

  IF is_referenced THEN
    RAISE EXCEPTION 'question_option_for_referenced_version_is_immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_question_options_guard_referenced ON question_options;
CREATE TRIGGER trg_question_options_guard_referenced
BEFORE INSERT OR UPDATE OR DELETE ON question_options
FOR EACH ROW EXECUTE FUNCTION ia_aprova_guard_question_option();

CREATE OR REPLACE FUNCTION ia_aprova_guard_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'attempt_snapshot_is_immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_attempts_guard_update ON attempts;
CREATE TRIGGER trg_attempts_guard_update
BEFORE UPDATE ON attempts
FOR EACH ROW EXECUTE FUNCTION ia_aprova_guard_attempt_update();

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0006_database_runtime_invariants', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
