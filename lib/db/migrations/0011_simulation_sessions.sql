-- Immutable, server-authoritative simulation snapshots and answers.
-- Simulations are isolated from adaptive attempts so exam answers never feed
-- mastery/calibration. The scoring engine revalidates the JSON snapshots;
-- relational constraints provide concurrency and ownership-safe invariants.

CREATE TABLE IF NOT EXISTS simulation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id),
  exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  blueprint_version_id uuid NOT NULL REFERENCES blueprint_versions(id),
  create_idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','finalized')),
  rules jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  state jsonb NOT NULL,
  result jsonb,
  result_hash text CHECK(result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL CHECK(deadline_at > started_at),
  finalized_at timestamptz,
  finish_reason text CHECK(finish_reason IS NULL OR finish_reason IN ('question-count','deadline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_simulation_state_shape CHECK (
    (status = 'active' AND finalized_at IS NULL AND finish_reason IS NULL
      AND result IS NULL AND result_hash IS NULL)
    OR
    (status = 'finalized' AND finalized_at IS NOT NULL AND finish_reason IS NOT NULL
      AND result IS NOT NULL AND result_hash IS NOT NULL)
  ),
  CONSTRAINT uq_simulation_create_idempotency UNIQUE(user_id, create_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_simulation_user_status_started
  ON simulation_sessions(user_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_deadline_status
  ON simulation_sessions(status, deadline_at);

CREATE TABLE IF NOT EXISTS simulation_questions (
  simulation_id uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK(position >= 0),
  question_version_id uuid NOT NULL REFERENCES question_versions(id),
  subject_id text NOT NULL REFERENCES subjects(id),
  option_ids uuid[] NOT NULL CHECK(cardinality(option_ids) BETWEEN 2 AND 100),
  correct_option_id uuid NOT NULL REFERENCES question_options(id),
  PRIMARY KEY(simulation_id, question_version_id),
  CONSTRAINT uq_simulation_question_position UNIQUE(simulation_id, position),
  CONSTRAINT ck_simulation_question_correct_in_options CHECK(correct_option_id = ANY(option_ids))
);

CREATE TABLE IF NOT EXISTS simulation_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  question_version_id uuid NOT NULL REFERENCES question_versions(id),
  selected_option_id uuid NOT NULL REFERENCES question_options(id),
  idempotency_key text NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_simulation_first_answer UNIQUE(simulation_id, question_version_id),
  CONSTRAINT uq_simulation_answer_idempotency UNIQUE(simulation_id, idempotency_key),
  CONSTRAINT simulation_answers_question_fkey
    FOREIGN KEY(simulation_id, question_version_id)
    REFERENCES simulation_questions(simulation_id, question_version_id)
);

CREATE OR REPLACE FUNCTION ia_aprova_validate_simulation_question()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  available_option_ids uuid[];
  correct_option_count integer;
BEGIN
  SELECT array_agg(id ORDER BY order_index),
         count(*) FILTER (WHERE is_correct)::integer
    INTO available_option_ids, correct_option_count
  FROM question_options
  WHERE question_version_id = NEW.question_version_id;

  IF available_option_ids IS NULL
     OR correct_option_count <> 1
     OR available_option_ids IS DISTINCT FROM NEW.option_ids
     OR NOT EXISTS (
       SELECT 1 FROM question_options
       WHERE id = NEW.correct_option_id
         AND question_version_id = NEW.question_version_id
         AND is_correct = true
     ) THEN
    RAISE EXCEPTION 'simulation_question_snapshot_invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_simulation_question_validate ON simulation_questions;
CREATE TRIGGER trg_simulation_question_validate
BEFORE INSERT OR UPDATE ON simulation_questions
FOR EACH ROW EXECUTE FUNCTION ia_aprova_validate_simulation_question();

-- Reuse the immutable-content freeze implemented by migration 0006.
DROP TRIGGER IF EXISTS trg_simulation_questions_freeze_question_version ON simulation_questions;
CREATE TRIGGER trg_simulation_questions_freeze_question_version
BEFORE INSERT OR UPDATE OF question_version_id ON simulation_questions
FOR EACH ROW EXECUTE FUNCTION ia_aprova_freeze_question_version_reference();

CREATE OR REPLACE FUNCTION ia_aprova_validate_simulation_answer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM simulation_questions question
    WHERE question.simulation_id = NEW.simulation_id
      AND question.question_version_id = NEW.question_version_id
      AND NEW.selected_option_id = ANY(question.option_ids)
  ) THEN
    RAISE EXCEPTION 'simulation_answer_option_invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_simulation_answer_validate ON simulation_answers;
CREATE TRIGGER trg_simulation_answer_validate
BEFORE INSERT ON simulation_answers
FOR EACH ROW EXECUTE FUNCTION ia_aprova_validate_simulation_answer();

CREATE OR REPLACE FUNCTION ia_aprova_guard_simulation_answer_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'simulation_answer_is_immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_simulation_answer_guard_update ON simulation_answers;
CREATE TRIGGER trg_simulation_answer_guard_update
BEFORE UPDATE ON simulation_answers
FOR EACH ROW EXECUTE FUNCTION ia_aprova_guard_simulation_answer_update();

CREATE OR REPLACE FUNCTION ia_aprova_guard_simulation_core()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.user_id, NEW.product_id, NEW.exam_version_id,
    NEW.blueprint_version_id, NEW.create_idempotency_key, NEW.rules,
    NEW.snapshot, NEW.snapshot_hash, NEW.started_at, NEW.deadline_at,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.user_id, OLD.product_id, OLD.exam_version_id,
    OLD.blueprint_version_id, OLD.create_idempotency_key, OLD.rules,
    OLD.snapshot, OLD.snapshot_hash, OLD.started_at, OLD.deadline_at,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'simulation_snapshot_is_immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'finalized' AND ROW(
    NEW.status, NEW.state, NEW.result, NEW.result_hash,
    NEW.finalized_at, NEW.finish_reason
  ) IS DISTINCT FROM ROW(
    OLD.status, OLD.state, OLD.result, OLD.result_hash,
    OLD.finalized_at, OLD.finish_reason
  ) THEN
    RAISE EXCEPTION 'simulation_result_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_simulation_core_guard ON simulation_sessions;
CREATE TRIGGER trg_simulation_core_guard
BEFORE UPDATE ON simulation_sessions
FOR EACH ROW EXECUTE FUNCTION ia_aprova_guard_simulation_core();

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0011_simulation_sessions', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
