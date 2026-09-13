/**
 * Reference Tables - Dados estáticos de referência
 * Concursos, Matérias, Bancas
 */

import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ============================================
// CONCURSOS (Exames públicos)
// ============================================
export const concursosTable = pgTable("concursos", {
  id: text("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  categoria: text("categoria").notNull(), // "militares" | "policiais" | "bancarios" | "fiscais" | "tribunais" | "administrativos" | "saude"
  descricao: text("descricao"),
  instituicao: text("instituicao").notNull(),
  ativo: boolean("ativo").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertConcursoSchema = createInsertSchema(concursosTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    nome: z.string().min(1),
    instituicao: z.string().min(1),
    categoria: z.enum([
      "militares",
      "policiais",
      "bancarios",
      "fiscais",
      "tribunais",
      "administrativos",
      "saude",
    ]),
  });

export type InsertConcurso = z.infer<typeof insertConcursoSchema>;
export type Concurso = typeof concursosTable.$inferSelect;

// ============================================
// MATERIAS (Subjects)
// ============================================
export const materiasTable = pgTable("materias", {
  id: text("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  slug: text("slug").notNull().unique(), // "direito-constitucional", "portuguesa", etc
  descricao: text("descricao"),
  iconName: text("icon_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMateriaSchema = createInsertSchema(materiasTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    nome: z.string().min(1),
    slug: z.string().min(1),
  });

export type InsertMateria = z.infer<typeof insertMateriaSchema>;
export type Materia = typeof materiasTable.$inferSelect;

// ============================================
// BANCAS (Exam boards/organizations)
// ============================================
export const bancasTable = pgTable("bancas", {
  id: text("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  sigla: text("sigla").notNull().unique(),
  descricao: text("descricao"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBancaSchema = createInsertSchema(bancasTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    nome: z.string().min(1),
    sigla: z.string().min(1),
  });

export type InsertBanca = z.infer<typeof insertBancaSchema>;
export type Banca = typeof bancasTable.$inferSelect;
