---
name: IA Aprova stats & ranking
description: How quiz-derived stats and ranking position are computed in the IA Aprova mobile app.
---

# Stats foundation
All quiz-derived stats live in `contexts/StatsContext.tsx` (`StatsProvider`/`useStats`),
persisted per user in AsyncStorage (`ia_aprova_stats_v1:<userId>`). Screens read from
`useStats` — do NOT reintroduce `MOCK_PROFILE`/`MOCK_PERFORMANCE`/`MOCK_ACHIEVEMENTS`
for stat values (those mocks remain only for static labels like `concursoAtivo`).

**Convention:** XP = 10 per correct answer. Rank/level tiers are the `RANKS` array in
StatsContext (Recruta → General). `getMateriaStat` returns `{materia, answered, correct, pct}`;
`weakSubjects`/`strongSubjects` expose `{name, accuracy}`; `byMateria` exposes `{materia, pct, answered}`.

# Ranking is NOT a real backend
**Rule:** Ranking position inserts the real user (custom display name + real XP) into the
sample `MOCK_RANKING` leaderboard, then sorts by XP. Position/topPercent are relative to that
sample set, not a global server.
**Why:** True global ranking needs a backend — intentionally out of scope.
**How to apply:** If asked for "real" ranking, this needs a backend service; the current
position is a local approximation by design.

# Display name
Custom display name ("como quer que eu te chame") is stored as `onboarding.displayName`
(AppContext, persisted). Collected on the concurso onboarding screen, editable at
`/profile/edit`. `hooks/useDisplayName.ts` resolves: custom → Clerk name → email prefix → mock.
