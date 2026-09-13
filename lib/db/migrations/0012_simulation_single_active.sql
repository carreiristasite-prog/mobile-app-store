-- A client can resume only one authoritative exam at a time. Refuse to hide
-- pre-existing duplicate active sessions instead of choosing one silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM simulation_sessions
    WHERE status = 'active'
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'simulation_multiple_active_sessions_require_adjudication';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_simulation_one_active_user
  ON simulation_sessions(user_id)
  WHERE status = 'active';

INSERT INTO __drizzle_migrations__(hash, created_at)
VALUES ('0012_simulation_single_active', CURRENT_TIMESTAMP)
ON CONFLICT(hash) DO NOTHING;
