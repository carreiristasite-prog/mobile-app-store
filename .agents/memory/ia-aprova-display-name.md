---
name: IA Aprova user display name
description: Where the logged-in user's name must come from in the IA Aprova app
---

User-facing names (home hero greeting, profile header, ranking "me" row) must come
from the real Clerk user via the `useDisplayName` hook (`hooks/useDisplayName.ts`),
never from `MOCK_PROFILE.name` (which is sample data like "Caynã Silva").

**Why:** MOCK_PROFILE.name is static, so every account showed the same hardcoded
name. Stats (xp, streak, rank) are still mock and may keep using MOCK_PROFILE.

**How to apply:** For any new screen that shows the current user's name/initials,
call `useDisplayName()` (fullName/firstName/initials). For ranking-style lists,
map rows flagged `isMe` to `fullName` at render time rather than baking a name
into the mock array.
