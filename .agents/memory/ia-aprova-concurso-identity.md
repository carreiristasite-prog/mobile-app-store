---
name: IA Aprova concurso identity
description: Two concurso identifiers exist; onboarding.concurso (name) is the source of truth for dynamic per-concurso content.
---

# Concurso identity in IA Aprova

There are TWO concurso identifiers in the app and they are NOT interchangeable:
- `selectedConcurso` (AppContext) — an **id** like `esa`, sourced from the `CONCURSOS` array.
- `onboarding.concurso` (AppContext, persisted) — a **name** like `ESA`, set during onboarding from `CONCURSO_CATEGORIES`.

**Rule:** `onboarding.concurso` (the name) is the source of truth for all dynamic
per-concurso content. `getSubjectsForConcurso(name)` and `CONCURSO_SUBJECTS` are keyed
by NAME. Home subjects, recommendations, weak point, XPBar pill, ranking/simulados/settings
titles all read `onboarding.concurso` (fallback `MOCK_PROFILE.concursoAtivo`).

**Why:** A bug had Home showing hardcoded subjects unrelated to the chosen concurso, and
the post-onboarding switcher (`contest/select.tsx`) only updated `selectedConcurso` (id),
so dynamic screens (which read the name) never changed. Any concurso switcher MUST call
`updateOnboarding({ concurso: name })`, not just `setSelectedConcurso(id)`.

**Caveat — id/name drift:** `CONCURSOS` (used by contest/select) has names like `PF`,
`TJ-SP` that do NOT match `CONCURSO_SUBJECTS` keys (`Polícia Federal`, `TJ`).
`getSubjectsForConcurso` falls back to `DEFAULT_SUBJECTS` for unmatched names (graceful, no
crash, but generic). If you need exact subjects for those, align the names or add a lookup.
There is a `CONCURSO_KEY_ALIASES` map inside mockData that bridges selector short-names
(`CONCURSOS[].name` like `PF`, `TJ-SP`) to the canonical `CONCURSO_SUBJECTS` keys
(`Polícia Federal`, `TJ`). When you add a concurso whose display name differs from its
subjects-map key, add it to that alias map or disciplines will silently go generic.

**Concurso-scoped local selections must self-invalidate on concurso change:** the
concurso is switched on its own screen (`contest/select.tsx`) while other screens stay
mounted, so any screen holding a concurso-scoped local selection (e.g. a chosen disciplina)
must drop that selection when it is no longer valid for the new `onboarding.concurso`.
**Why:** since the questions screen has no concurso selector of its own (concurso is implicit
from onboarding), `onboarding.concurso` is the only signal a switch happened; without
re-validating, a stale value from the previous concurso lingers in the UI.

**How to apply:** When wiring anything concurso-related, resolve display + subjects from
`onboarding.concurso`. Do not display a year next to the concurso name (product decision —
year removed everywhere; question metadata banca+year like "CESPE 2023" is unrelated and kept).

**Matéria-scoped quiz navigation:** Home cards (IA recomenda, "Continue de onde parou",
"Recomendações", Meta Diária CTA) must open the quiz with a `materia` route param. The quiz
flow (index/result/explanation) resolves its question set via `getQuestionsForMateria(materia)`,
NOT the raw `MOCK_QUESTIONS`. The mock bank only covers a few subjects, so that helper falls
back to the full bank when no question matches the requested matéria (graceful, not a bug).
Pass `qid` to `/quiz/explanation` so it shows the exact question via `getQuestionById`.
**Why:** previously every card hard-routed to `/quiz` with no subject, so taps always showed
the same generic questions regardless of the matéria clicked.
