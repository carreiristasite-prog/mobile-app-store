---
name: IA Aprova expo-router routing
description: How expo-router v6 names routes for files inside directories without _layout.tsx
---

In expo-router v6, a file like `app/quiz/index.tsx` without a sibling `_layout.tsx` is a **flat route** named `quiz/index`, not `quiz`.

**Why:** expo-router only collapses `index` to its parent directory name when the directory has its own `_layout.tsx` (making it a group/segment). Without `_layout.tsx`, all files in the directory register as flat siblings named `<dir>/<file>`.

**How to apply:**
- Stack.Screen names must use full paths: `quiz/index`, `quiz/result`, `quiz/explanation` — not just `quiz`.
- Navigation calls like `router.push('/quiz')` still resolve to `quiz/index` automatically.
- To use short names in Stack.Screen (e.g. `name="quiz"`), add a `_layout.tsx` to the directory.
- The full list of registered route names is logged in the console as `[Layout children]: No route named "X" exists in nested children: [...]` which reveals the actual names expo-router sees.
