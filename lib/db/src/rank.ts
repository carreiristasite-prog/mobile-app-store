/**
 * Tabela de patentes/ranks derivada do XP total do usuário.
 * Usado pelo backend (cálculo de rank ao atualizar users.xp_total)
 * e pelo app mobile (exibição de patente/progresso).
 */

export const DIFFICULTY_LEVELS = ["facil", "medio", "dificil"] as const;
export const SIMULADO_FORMATS = ["completo", "por_materia", "tempo_real", "customizado"] as const;
export const DUEL_MODES = ["random", "materia_specific", "ranked"] as const;

export const RANK_LEVELS = [
  { rank: 0, name: "Recruta", minXp: 0 },
  { rank: 1, name: "Soldado", minXp: 100 },
  { rank: 2, name: "Cabo", minXp: 250 },
  { rank: 3, name: "Sargento", minXp: 500 },
  { rank: 4, name: "Subtenente", minXp: 1000 },
  { rank: 5, name: "Aspirante", minXp: 1800 },
  { rank: 6, name: "Tenente", minXp: 3000 },
  { rank: 7, name: "Capitão", minXp: 5000 },
  { rank: 8, name: "Major", minXp: 8000 },
  { rank: 9, name: "Coronel", minXp: 12000 },
  { rank: 10, name: "General", minXp: 20000 },
] as const;

export function getRankFromXp(xp: number): number {
  for (let i = RANK_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= RANK_LEVELS[i].minXp) {
      return RANK_LEVELS[i].rank;
    }
  }
  return 0;
}

export function getRankName(rank: number): string {
  const rankLevel = RANK_LEVELS.find((r) => r.rank === rank);
  return rankLevel?.name ?? "Recruta";
}

export function getNextRankXp(currentRank: number): number {
  const nextRank = RANK_LEVELS.find((r) => r.rank === currentRank + 1);
  return nextRank?.minXp ?? RANK_LEVELS[RANK_LEVELS.length - 1].minXp;
}
