/**
 * Questions Table - Base de questões
 * Estrutura completa com alternativas, explicações
 */

import { pgTable, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { concursosTable, materiasTable, bancasTable } from "./reference";
import { usersTable } from "./users";

// ============================================
// QUESTIONS
// ============================================
export const questionsTable = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),

    // Identificação
    concursoId: text("concurso_id").notNull().references(() => concursosTable.id),
    materiaId: text("materia_id").notNull().references(() => materiasTable.id),
    bancaId: text("banca_id").notNull().references(() => bancasTable.id),

    // Conteúdo
    enunciado: text("enunciado").notNull(), // statement/problem
    alternatives: jsonb("alternatives").notNull().$type<{ id: string; text: string }[]>(),
    correctAlternativeId: text("correct_alternative_id").notNull(),
    explanation: text("explanation"), // explicação geral
    alternativeExplanations: jsonb("alternative_explanations").$type<Record<string, string>>(), // explicações por alternativa

    // Metadata
    dificuldade: text("dificuldade").default("medio"), // "facil", "medio", "dificil"
    year: integer("year"), // ano da prova
    imageUrl: text("image_url"), // se houver imagem na questão

    // Rastreamento
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_questions_concurso").on(table.concursoId),
    index("idx_questions_materia").on(table.materiaId),
  ],
);

export const insertQuestionSchema = createInsertSchema(questionsTable)
  .omit({ createdAt: true, updatedAt: true })
  .extend({
    id: z.string().min(1),
    enunciado: z.string().min(10),
    alternatives: z.array(z.object({
      id: z.string(),
      text: z.string(),
    })).min(2),
    correctAlternativeId: z.string(),
    dificuldade: z.enum(["facil", "medio", "dificil"]).optional(),
  });

export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;

// ============================================
// USER_ANSWERS - Respostas do usuário a questões
// ============================================
export const userAnswersTable = pgTable(
  "user_answers",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id")
      .notNull()
      .references(() => usersTable.clerkUserId, { onDelete: "cascade" }),
    questionId: text("question_id").notNull().references(() => questionsTable.id),
    selectedAlternativeId: text("selected_alternative_id").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    timeSpentSeconds: integer("time_spent_seconds"),
    source: text("source").default("practice"), // "practice", "simulado", "duel"
    sourceId: text("source_id"), // ID do simulado ou duel se aplicável
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_answers_user").on(table.clerkUserId),
    index("idx_user_answers_question").on(table.questionId),
  ],
);

export const insertUserAnswerSchema = createInsertSchema(userAnswersTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    clerkUserId: z.string(),
    questionId: z.string(),
    selectedAlternativeId: z.string(),
    isCorrect: z.boolean(),
    source: z.enum(["practice", "simulado", "duel"]).optional(),
  });

export type InsertUserAnswer = z.infer<typeof insertUserAnswerSchema>;
export type UserAnswer = typeof userAnswersTable.$inferSelect;
