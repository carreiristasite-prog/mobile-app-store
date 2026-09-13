export function assertClerkConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const secretKey = env.CLERK_SECRET_KEY ?? "";
  const publishableKey = env.CLERK_PUBLISHABLE_KEY ?? "";
  const allowTestKeys = env.CLERK_ALLOW_TEST_KEYS === "true";
  if (allowTestKeys) {
    if (!/^sk_(?:test|live)_[A-Za-z0-9_-]+$/.test(secretKey)) {
      throw new Error("CLERK_SECRET_KEY is invalid");
    }
    if (!/^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(publishableKey)) {
      throw new Error("CLERK_PUBLISHABLE_KEY is invalid");
    }
    return;
  }
  if (!/^sk_live_[A-Za-z0-9_-]+$/.test(secretKey)) {
    throw new Error("CLERK_SECRET_KEY must be a production Clerk secret key");
  }
  if (!/^pk_live_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("CLERK_PUBLISHABLE_KEY must be a production Clerk publishable key");
  }
}
