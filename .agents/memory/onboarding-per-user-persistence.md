---
name: Per-user onboarding/gating persistence
description: Why AsyncStorage onboarding/completion state must be keyed by Clerk user id in the ia-aprova app
---

# Per-user onboarding persistence

Any AsyncStorage state that gates app access (onboarding completion, "has finished setup", plan-ready flags) MUST be scoped by the authenticated user id, not stored under a single global key.

**Why:** With a global key, a device that has one user complete onboarding will report `onboardingComplete=true` for the *next* user who signs in on that same device, letting them skip required steps and bypass the gate. Found during code review of the ia-aprova onboarding flow.

**How to apply (ia-aprova `contexts/AppContext.tsx`):**
- Key = `${STORAGE_PREFIX}:${userId ?? 'anon'}` via `storageKeyFor(userId)`, with `userId` from `@clerk/expo` `useAuth()`.
- Rehydrate on `[isLoaded, userId]` change; set `onboardingLoaded=false` while reloading so gating layouts render null (no flash / no stale read) until the correct user's state is loaded.
- `AppProvider` must sit inside `ClerkProvider`/`ClerkLoaded` so `useAuth()` is available.
- Gating layouts (`(tabs)/_layout`, `(onboarding)/_layout`) wait for `isLoaded && onboardingLoaded` before any redirect.
