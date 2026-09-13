-- Migration 0002: corrige gaps de integridade encontrados na auditoria do schema 0001.
-- Database: PostgreSQL
-- Pré-lançamento, sem dados reais em produção — seguro rodar direto.

-- ============================================
-- 1. FK faltando em users.concurso_id
-- ============================================
ALTER TABLE "users"
  ADD CONSTRAINT "users_concurso_id_fkey"
  FOREIGN KEY ("concurso_id") REFERENCES "concursos"("id");

-- ============================================
-- 2. UNIQUE em user_achievements(clerk_user_id, achievement_id)
--    Evita desbloquear a mesma conquista duas vezes para o mesmo usuário.
-- ============================================
ALTER TABLE "user_achievements"
  ADD CONSTRAINT "uq_user_achievements_user_achievement"
  UNIQUE ("clerk_user_id", "achievement_id");

-- ============================================
-- 3. Índices faltando (consultas comuns sem índice)
-- ============================================
CREATE INDEX IF NOT EXISTS "idx_user_achievements_user" ON "user_achievements"("clerk_user_id");
CREATE INDEX IF NOT EXISTS "idx_duels_winner" ON "duels"("winner_id");
CREATE INDEX IF NOT EXISTS "idx_simulado_questions_simulado" ON "simulado_questions"("simulado_id");

-- ============================================
-- 4. ON DELETE CASCADE em toda FK que referencia users.clerk_user_id.
--    Pré-requisito para o fluxo de exclusão de conta (Apple 5.1.1(v)):
--    apagar o usuário deve apagar em cascata seu histórico, sem violar FK.
--    Postgres não permite ALTER de ON DELETE in-place: recria a constraint.
-- ============================================
ALTER TABLE "user_answers"
  DROP CONSTRAINT IF EXISTS "user_answers_clerk_user_id_fkey",
  ADD CONSTRAINT "user_answers_clerk_user_id_fkey"
    FOREIGN KEY ("clerk_user_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "simulados"
  DROP CONSTRAINT IF EXISTS "simulados_clerk_user_id_fkey",
  ADD CONSTRAINT "simulados_clerk_user_id_fkey"
    FOREIGN KEY ("clerk_user_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "duels"
  DROP CONSTRAINT IF EXISTS "duels_player1_id_fkey",
  ADD CONSTRAINT "duels_player1_id_fkey"
    FOREIGN KEY ("player1_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "duels"
  DROP CONSTRAINT IF EXISTS "duels_player2_id_fkey",
  ADD CONSTRAINT "duels_player2_id_fkey"
    FOREIGN KEY ("player2_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "duels"
  DROP CONSTRAINT IF EXISTS "duels_winner_id_fkey",
  ADD CONSTRAINT "duels_winner_id_fkey"
    FOREIGN KEY ("winner_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "user_achievements"
  DROP CONSTRAINT IF EXISTS "user_achievements_clerk_user_id_fkey",
  ADD CONSTRAINT "user_achievements_clerk_user_id_fkey"
    FOREIGN KEY ("clerk_user_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "user_stats"
  DROP CONSTRAINT IF EXISTS "user_stats_clerk_user_id_fkey",
  ADD CONSTRAINT "user_stats_clerk_user_id_fkey"
    FOREIGN KEY ("clerk_user_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

ALTER TABLE "study_logs"
  DROP CONSTRAINT IF EXISTS "study_logs_clerk_user_id_fkey",
  ADD CONSTRAINT "study_logs_clerk_user_id_fkey"
    FOREIGN KEY ("clerk_user_id") REFERENCES "users"("clerk_user_id") ON DELETE CASCADE;

-- ============================================
-- Registrar migration
-- ============================================
INSERT INTO "__drizzle_migrations__" ("hash", "created_at")
VALUES ('0002_schema_fixes', CURRENT_TIMESTAMP)
ON CONFLICT ("hash") DO NOTHING;
