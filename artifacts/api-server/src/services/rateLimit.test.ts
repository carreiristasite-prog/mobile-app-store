import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "../middlewares/rateLimit.ts";

function run(handler: ReturnType<typeof createRateLimiter>, ip = "127.0.0.1") {
  const headers = new Map<string, string>();
  const req = { ip } as any;
  const res = { setHeader(name: string, value: string) { headers.set(name, value); } } as any;
  let error: unknown = null;
  let called = false;
  handler(req, res, (nextError?: unknown) => { error = nextError ?? null; called = true; });
  return { headers, error, called };
}

test("rate limiter rejects only after the configured maximum and emits retry metadata", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(run(limiter).called, true);
  assert.equal(run(limiter).called, true);
  const blocked = run(limiter);
  assert.equal(blocked.called, true);
  assert.equal((blocked.error as { status: number }).status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.equal(blocked.headers.get("x-ratelimit-remaining"), "0");
});

test("rate limiter isolates keys and bounds its map", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2 });
  assert.equal(run(limiter, "a").error, null);
  assert.equal(run(limiter, "b").error, null);
  assert.equal((run(limiter, "a").error as { status: number }).status, 429);
  assert.equal((run(limiter, "b").error as { status: number }).status, 429);
  assert.equal(run(limiter, "c").error, null);
  assert.equal(run(limiter, "a").error, null);
});
