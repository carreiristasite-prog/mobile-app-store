import assert from "node:assert/strict";
import test from "node:test";
import { deterministicBackoffMs } from "./backoff.ts";

test("backoff is deterministic, exponential and capped", () => {
  const input = { eventId: "10000000-0000-4000-8000-000000000001", baseMs: 1_000, maxMs: 8_000, jitterRatio: 0 };
  assert.equal(deterministicBackoffMs({ ...input, attempt: 1 }), 1_000);
  assert.equal(deterministicBackoffMs({ ...input, attempt: 2 }), 2_000);
  assert.equal(deterministicBackoffMs({ ...input, attempt: 10 }), 8_000);
  assert.equal(
    deterministicBackoffMs({ ...input, attempt: 3, jitterRatio: 0.2 }),
    deterministicBackoffMs({ ...input, attempt: 3, jitterRatio: 0.2 }),
  );
});

test("jitter stays inside the configured limit", () => {
  const value = deterministicBackoffMs({
    eventId: "10000000-0000-4000-8000-000000000002",
    attempt: 1,
    baseMs: 10_000,
    maxMs: 100_000,
    jitterRatio: 0.2,
  });
  assert.ok(value >= 8_000 && value <= 12_000);
});
