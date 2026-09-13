/**
 * Gamification Tables - Simulados, Duelos, Achievements, Stats
 */

import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { concursosTable, materiasTable } from "./reference";
import { questionsTable } from "./questions";

// ============================================
// SIMULADOS (Practice exams)
// ============================================
export const simuladosTable = pgTable(
  "simulados",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id")
      .notNull()
      .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    concursoId: text("concurso_id").notNull().references(() => concursosTable.id),
    format: text("format").default("completo"), // "completo", "por_materia", "tempo_real", "customizado"
    totalQuestions: integer("total_questions").notNull(),
    correctAnswers: integer("correct_answers").default(0),
    timeSpentSeconds: integer("time_spent_seconds").default(0),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
    score: integer("score").default(0), // 0-100
    percentile: integer("percentile"), // posição percentual
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_simulados_user").on(table.clerkUserId),
    index("idx_simulados_concurso").on(table.concursoId),
  ],
);

export const insertSimuladoSchema = createInsertSchema(simuladosTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    format: z.enum(["completo", "por_materia", "tempo_real", "customizado"]).optional(),
    totalQuestions: z.number().min(1),
    correctAnswers: z.number().min(0).optional(),
  });

export type InsertSimulado = z.infer<typeof insertSimuladoSchema>;
export type Simulado = typeof simuladosTable.$inferSelect;

// ============================================
// SIMULADO_QUESTIONS - Association entre simulado e questões
// ============================================
export const simuladoQuestionsTable = pgTable(
  "simulado_questions",
  {
    id: text("id").primaryKey(),
    simuladoId: text("simulado_id")
      .notNull()
      .references(() => simuladosTable.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull().references(() => questionsTable.id),
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_simulado_questions_simulado").on(table.simuladoId)],
);

export const insertSimuladoQuestionSchema = createInsertSchema(simuladoQuestionsTable).omit({
  createdAt: true,
});

export type InsertSimuladoQuestion = z.infer<typeof insertSimuladoQuestionSchema>;
export type SimuladoQuestion = typeof simuladoQuestionsTable.$inferSelect;

// ============================================
// DUELS - Competições entre usuários
// ============================================
export const duelsTable = pgTable(
  "duels",
  {
    id: text("id").primaryKey(),
    player1Id: text("player1_id")
      .notNull()
      .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    player2Id: text("player2_id")
      .notNull()
      .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    mode: text("mode").default("random"), // "random", "materia_specific", "ranked"
    totalQuestions: integer("total_questions").default(10),
    player1Score: integer("player1_score").default(0),
    player2Score: integer("player2_score").default(0),
    winnerId: text("winner_id").references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_duels_player1").on(table.player1Id),
    index("idx_duels_player2").on(table.player2Id),
    index("idx_duels_winner").on(table.winnerId),
  ],
);

export const insertDuelSchema = createInsertSchema(duelsTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    mode: z.enum(["random", "materia_specific", "ranked"]).optional(),
  });

export type InsertDuel = z.infer<typeof insertDuelSchema>;
export type Duel = typeof duelsTable.$inferSelect;

// ============================================
// ACHIEVEMENTS - Conquistas desbloqueadas
// ============================================
export const achievementsTable = pgTable("achievements", {
  id: text("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  descricao: text("descricao"),
  iconName: text("icon_name"),
  condicao: text("condicao"), // descrição da condição (ex: "100 questões corretas")
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAchievementSchema = createInsertSchema(achievementsTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    nome: z.string().min(1),
  });

export type InsertAchievement = z.infer<typeof insertAchievementSchema>;
export type Achievement = typeof achievementsTable.$inferSelect;

// ============================================
// USER_ACHIEVEMENTS - Associação de achievements desbloqueados
// Um usuário não pode desbloquear a mesma conquista duas vezes (constraint UNIQUE).
// ============================================
export const userAchievementsTable = pgTable(
  "user_achievements",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id")
      .notNull()
      .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull().references(() => achievementsTable.id),
    unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_achievements_user").on(table.clerkUserId),
    uniqueIndex("uq_user_achievements_user_achievement").on(
      table.clerkUserId,
      table.achievementId,
    ),
  ],
);

export const insertUserAchievementSchema = createInsertSchema(userAchievementsTable).extend({
  id: z.string().min(1),
});

export type InsertUserAchievement = z.infer<typeof insertUserAchievementSchema>;
export type UserAchievement = typeof userAchievementsTable.$inferSelect;

// ============================================
// USER_STATS - Stats agregadas (cache para performance)
// ============================================
export const userStatsTable = pgTable("user_stats", {
  clerkUserId: text("clerk_user_id")
    .primaryKey()
    .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
  totalQuestionsAnswered: integer("total_questions_answered").default(0),
  totalCorrect: integer("total_correct").default(0),
  totalIncorrect: integer("total_incorrect").default(0),
  overallAccuracy: integer("overall_accuracy").default(0), // 0-100
  totalStudyTimeSeconds: integer("total_study_time_seconds").default(0),
  thisWeekStudyTimeSeconds: integer("this_week_study_time_seconds").default(0),
  lastStudyDate: timestamp("last_study_date"),
  bestStreak: integer("best_streak").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserStatsSchema = createInsertSchema(userStatsTable).omit({
  updatedAt: true,
});

export type InsertUserStats = z.infer<typeof insertUserStatsSchema>;
export type UserStats = typeof userStatsTable.$inferSelect;

// ============================================
// STUDY_LOGS - Log detalhado de sessões de estudo
// ============================================
export const studyLogsTable = pgTable(
  "study_logs",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id")
      .notNull()
      .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    materiaId: text("materia_id").notNull().references(() => materiasTable.id),
    durationSeconds: integer("duration_seconds").notNull(),
    questionsAnswered: integer("questions_answered").default(0),
    correctAnswers: integer("correct_answers").default(0),
    sessionType: text("session_type").default("free_practice"), // "free_practice", "timed", "simulado"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_study_logs_user").on(table.clerkUserId)],
);

export const insertStudyLogSchema = createInsertSchema(studyLogsTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    clerkUserId: z.string(),
    materiaId: z.string(),
    durationSeconds: z.number().min(1),
  });

export type InsertStudyLog = z.infer<typeof insertStudyLogSchema>;
export type StudyLog = typeof studyLogsTable.$inferSelect;
