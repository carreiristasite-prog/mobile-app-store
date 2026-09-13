/**
 * Users Table - Dados centrais do usuário
 * Integrado com Clerk para autenticação (clerk_user_id é a chave primária)
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { concursosTable } from "./reference";

export const usersTable = pgTable("users", {
  // UUID interno estável. IDs de provedores externos não são identidade de
  // domínio nas tabelas /v1.
  id: uuid("id").notNull().defaultRandom(),
  // Clerk user ID como primary key
  clerkUserId: text("clerk_user_id").primaryKey(),

  // Dados básicos
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),

  // Onboarding
  concursoId: text("concurso_id").references(() => concursosTable.id),
  dailyGoalMinutes: integer("daily_goal_minutes").default(30),

  // Gamification
  xpTotal: integer("xp_total").default(0),
  currentRank: integer("current_rank").default(0), // 0-10 (Recruta to General)
  currentStreak: integer("current_streak").default(0),
  maxStreak: integer("max_streak").default(0),

  // Premium (sincronizado via webhook do RevenueCat)
  isPremium: boolean("is_premium").default(false),
  premiumExpiresAt: timestamp("premium_expires_at"),
  stripeCustomerId: text("stripe_customer_id"),

  // Rastreamento
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at"),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [uniqueIndex("uq_users_internal_id").on(table.id)]);

export const insertUserSchema = createInsertSchema(usersTable)
  .omit({ createdAt: true, updatedAt: true })
  .extend({
    email: z.string().email(),
    displayName: z.string().min(1),
    dailyGoalMinutes: z.number().min(5).max(480).optional(),
  });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
