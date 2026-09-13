---
name: IA Aprova per-user persistence contexts
description: How StatsContext/ActivityContext gate AsyncStorage writes per Clerk user and the race-condition guard required
---

# Per-user AsyncStorage contexts (IA Aprova)

IA Aprova persists user activity (favorites, marked, reports, study logs, simulado & duel
history) and stats per Clerk `userId` in AsyncStorage. Contexts hydrate asynchronously on
`[isLoaded, userId]` (e.g. `ActivityContext`, `StatsContext`).

## Rule: gate every write until hydration completes
A mutator that fires before the current user's data has loaded can persist stale/empty
state into the new user's key (especially right after an account switch). Guard writes with
a `loadedRef` (a ref, not just the `loaded` state) set `false` at the start of the hydration
effect and `true` in its `finally`; have the central `update()` early-return when
`!loadedRef.current`.

**Why:** without this, a fast interaction during the brief async hydration window corrupts
per-user data. State `loaded` alone is not enough because closures in mutators capture stale
values — use a ref.

**How to apply:** when adding any new persisted per-user context here, copy the loadedRef
gate. When adding a new mutator, route it through the gated `update()` rather than calling
`setData`/persist directly.

## Finish-once paths
Screens that record a result on multiple triggers (timer expiry + manual finish + last-item
Next) must guard with a `finishedRef` so the result is recorded exactly once: simulados
(`simulados/active.tsx`), duelo (`duelo/match.tsx`), quiz (`quiz/index.tsx`).

## RN Web: disabled TouchableOpacity blocks child Switch
A `Switch` (or any pressable child) nested inside a `TouchableOpacity`/`Pressable`
with `disabled={true}` is itself uninteractive on React Native Web — the parent
applies `pointer-events: none` and the a11y tree marks descendants disabled.
**How to apply:** for settings-style rows where the row toggles a Switch, render the
toggle row as a plain `View`, not a disabled touchable; reserve TouchableOpacity for
rows that are actually pressable (nav). Verified via e2e: the switch showed
`[disabled]` until the wrapper was changed from a disabled touchable to a View.

**Hydration of toggle state:** don't disable the Switch while async storage loads
(that reintroduces the stuck-disabled bug) and don't simply skip hydration if the
user already toggled (that drops stored values for untouched keys). Instead record
pre-hydration user changes in a `pendingRef`, and on hydration merge
`{ ...DEFAULT, ...stored, ...pendingRef.current }`, re-persisting if pending was
non-empty.

## Quiz progression lock
Quiz advance is animation-driven (fade callback ~150ms). Without a lock, rapid Next taps in
exam mode re-run `commitAnswer` for the same question and duplicate answer-log entries. Guard
`handleNext` with an `advancingRef` set true before the fade-out and reset in `advance()`.
