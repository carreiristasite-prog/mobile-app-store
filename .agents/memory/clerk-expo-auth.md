---
name: Clerk Expo Auth quirks
description: Pitfalls and fixes for integrating @clerk/expo into the IA Aprova pnpm monorepo
---

# Clerk Expo Auth — Quirks

## FieldError type
`errors.fields.identifier`, `errors.fields.password`, `errors.fields.emailAddress`, `errors.fields.code` are all `FieldError` objects — access `.message` directly (e.g. `errors?.fields?.identifier?.message`). Do NOT use `?.[0]?.message` (FieldError is not an array).

**Why:** Clerk Core v3 `FieldError` is a typed object, not an array. Prior knowledge from v2 suggested arrays.

## errors.global
`errors.global` may be an array or undefined. Use `(errors?.global as any)?.[0]?.message ?? (errors?.global as any)?.message` to be safe.

## SignInFields vs SignUpFields
- Sign-in: the email/identifier field key is `identifier`, not `emailAddress`.
- Sign-up: the email field key is `emailAddress`.
- Code verification field key is `code` in both flows.

**Why:** Clerk uses different field names for sign-in vs sign-up to distinguish identifier-based vs email-based flows.

## @solana Metro crash
`@clerk/expo` pulls in `@solana/programs` as a transitive dependency. When pnpm installs it, a `programs_tmp_NNNN/dist` directory is referenced that doesn't exist, causing Metro's FallbackWatcher to crash with `ENOENT`.

**Fix:** Add to `metro.config.js`:
```js
config.resolver.blockList = [
  /node_modules\/.pnpm\/@solana\+programs.*/,
  /node_modules\/.pnpm\/@solana.*programs_tmp.*/,
];
```

**Why:** Metro tries to watch all node_modules in the workspace; the `@solana/programs` package has a temporary dist dir that is created at build time but doesn't exist after install.

## Package versions (SDK 54)
- `@clerk/expo` — latest (no pinning needed)
- `expo-auth-session@~7.0.10`
- `expo-secure-store@~15.0.8`
- `expo-crypto@~15.0.8`
- `expo-web-browser@~15.0.10` (already in project)

## dev script
Must prepend `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY` to the dev command so Metro has the key at bundle time.

## ClerkProvider placement
Must wrap OUTSIDE `<SafeAreaProvider>` and `<ErrorBoundary>` but INSIDE the font loading check (so fonts still gate rendering). `<ClerkLoaded>` wraps the inner tree to delay rendering until Clerk JS is ready.

## API server
Must mount `clerkProxyMiddleware` BEFORE `cors()` and `express.json()` (it streams raw bytes). Use `publishableKeyFromHost` from `@clerk/shared/keys` to resolve key per request host.
