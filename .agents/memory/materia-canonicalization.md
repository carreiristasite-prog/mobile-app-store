---
name: Materia canonicalization (IA Aprova)
description: Why study-plan/stats subject matching must go through canonMateria, and where it bites.
---

In the IA Aprova mobile app, a "materia" (subject) string appears in three places with
DIFFERENT labels: the question bank (`MOCK_QUESTIONS[].materia`, e.g. "Língua Portuguesa"),
the per-concurso subject lists (`getSubjectsForConcurso`, e.g. "Português"), and the
user-built study plan (`studyPlan[].materia`).

**Rule:** any time you match a subject across the plan/stats boundary, normalize BOTH
sides through `canonMateria(m)` (in `constants/mockData.ts`, backed by `MATERIA_ALIASES`).
This applies to the write path (stats aggregation keys) AND the read path
(`getTodayMateriaCount`, `getMateriaStat`).

**Why:** progress on a study-plan card is computed as `getTodayMateriaCount(planSubject)`.
If the plan uses "Português" but the quiz recorded answers under the bank's
"Língua Portuguesa", an exact-string match returns 0 and the user sees "no progress"
despite practicing. canonMateria collapses the aliases so they count together.

**How to apply:** keep `byMateria[].materia` as the human display label, but key
`todayByMateria` by `canonMateria(...)` and canonicalize the argument in any lookup.
