import assert from "node:assert/strict";
import test from "node:test";
import { WorkerEngine, type EngineOptions } from "./engine.ts";
import { DeferredWorkerError, InvalidEventError, RetryableWorkerError } from "./errors.ts";
import type { OutboxEvent, SafeLogger, WorkerRepository } from "./types.ts";

const now = new Date("2026-08-20T12:00:00.000Z");
const event: OutboxEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  aggregateType: "billing_restore",
  aggregateId: "20000000-0000-4000-8000-000000000002",
  eventType: "billing.restore_requested.v1",
  payload: {},
  occurredAt: now,
  availableAt: new Date(now.getTime() + 60_000),
  processedAt: null,
  attempts: 1,
};
const options: EngineOptions = {
  pollIntervalMs: 1_000,
  batchSize: 10,
  leaseMs: 60_000,
  maxAttempts: 3,
  backoffBaseMs: 2_000,
  backoffMaxMs: 60_000,
  backoffJitterRatio: 0,
};
const silent: SafeLogger = { info() {}, warn() {}, error() {} };

function repository(overrides: Partial<WorkerRepository> = {}): WorkerRepository {
  return {
    claimBatch: async () => [event],
    extendLease: async () => true,
    markProcessed: async () => true,
    reschedule: async () => true,
    deadLetter: async () => true,
    deadLetterCount: async () => 0,
    ping: async () => undefined,
    scheduleDailyBillingReconciliation: async () => 0,
    reconcileProEntitlement: async () => false,
    completeBillingReconciliationItem: async () => undefined,
    failBillingReconciliationItem: async () => undefined,
    finalizeSimulationDeadline: async () => ({ status: "missing" }),
    getDataRequest: async () => null,
    startDataRequest: async () => null,
    buildUserExportSnapshot: async () => ({ schemaVersion: 1, subjectId: event.aggregateId, requestedAt: now.toISOString(), datasets: {} }),
    recordDataRequestStep: async () => undefined,
    listUserExportObjects: async () => [],
    recordExportObjectsRevoked: async () => undefined,
    revokeUserAccess: async () => ({ clerkSubject: "unused", revenueCatCustomerId: "unused" }),
    eraseUserData: async () => undefined,
    completeDataRequest: async () => true,
    ...overrides,
  };
}

test("claims only registered event types and marks a successful fenced attempt", async () => {
  let claimedTypes: readonly string[] = [];
  let markedAttempt = 0;
  const repo = repository({
    claimBatch: async (input) => { claimedTypes = input.eventTypes; return [event]; },
    markProcessed: async (_id, attempt) => { markedAttempt = attempt; return true; },
  });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async () => undefined]]), silent, options, () => now);
  const summary = await engine.runOnce();
  assert.deepEqual(claimedTypes, [event.eventType]);
  assert.equal(markedAttempt, event.attempts);
  assert.deepEqual(summary, { claimed: 1, processed: 1, retried: 0, deadLettered: 0 });
});

test("retryable failures use deterministic exponential rescheduling", async () => {
  const rescheduleCapture: { availableAt: Date | null } = { availableAt: null };
  const repo = repository({ reschedule: async (_id, _attempt, date) => { rescheduleCapture.availableAt = date; return true; } });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async () => {
    throw new RetryableWorkerError("upstream_unavailable");
  }]]), silent, options, () => now);
  const summary = await engine.runOnce();
  assert.equal(rescheduleCapture.availableAt?.toISOString(), new Date(now.getTime() + 2_000).toISOString());
  assert.equal(summary.retried, 1);
});

test("deferred work is rescheduled at the exact durable deadline without backoff", async () => {
  const deadlineAt = new Date("2026-08-20T13:00:00.000Z");
  const captured: { date: Date | null; attempt: number | null; marked: number } = {
    date: null,
    attempt: null,
    marked: 0,
  };
  const repo = repository({
    reschedule: async (_id, attempt, date) => {
      captured.date = date;
      captured.attempt = attempt;
      return true;
    },
    markProcessed: async () => { captured.marked += 1; return true; },
  });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async () => {
    throw new DeferredWorkerError("simulation_deadline_not_due", deadlineAt);
  }]]), silent, options, () => now);
  const summary = await engine.runOnce();
  assert.equal(captured.date?.toISOString(), deadlineAt.toISOString());
  assert.equal(captured.attempt, event.attempts);
  assert.equal(captured.marked, 0);
  assert.deepEqual(summary, { claimed: 1, processed: 0, retried: 1, deadLettered: 0 });
});

test("invalid events are dead-lettered immediately", async () => {
  let deadLetters = 0;
  const repo = repository({ deadLetter: async () => { deadLetters += 1; return true; } });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async () => {
    throw new InvalidEventError("invalid_payload");
  }]]), silent, options, () => now);
  const summary = await engine.runOnce();
  assert.equal(deadLetters, 1);
  assert.equal(summary.deadLettered, 1);
});

test("the attempt fence prevents an expired owner from acknowledging work", async () => {
  let retries = 0;
  const repo = repository({
    markProcessed: async () => false,
    reschedule: async () => { retries += 1; return true; },
  });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async () => undefined]]), silent, options, () => now);
  const summary = await engine.runOnce();
  assert.equal(retries, 0);
  assert.deepEqual(summary, { claimed: 1, processed: 0, retried: 0, deadLettered: 0 });
});

test("long handlers renew their lease before acknowledgement", async () => {
  let renewals = 0;
  const repo = repository({ extendLease: async () => { renewals += 1; return true; } });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  }]]), silent, { ...options, leaseMs: 300 }, () => new Date());
  await engine.runOnce();
  assert.ok(renewals >= 1);
});

test("stopping claims lets active work drain before forced abort", async () => {
  let release!: () => void;
  const handlerCapture: { signal: AbortSignal | null } = { signal: null };
  const handlerDone = new Promise<void>((resolve) => { release = resolve; });
  let claims = 0;
  const repo = repository({
    claimBatch: async () => { claims += 1; return claims === 1 ? [event] : []; },
  });
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async (_event, context) => {
    handlerCapture.signal = context.signal;
    await handlerDone;
  }]]), silent, options, () => now);
  const stop = new AbortController();
  const running = engine.run(stop.signal);
  while (engine.activeCount === 0) await new Promise((resolve) => setImmediate(resolve));
  stop.abort();
  assert.equal(handlerCapture.signal?.aborted, false);
  release();
  await running;
  assert.equal(engine.activeCount, 0);
});

test("forced shutdown aborts the active handler signal", async () => {
  let observedAbort = false;
  const repo = repository();
  const engine = new WorkerEngine(repo, new Map([[event.eventType, async (_event, context) => {
    await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => {
      observedAbort = true;
      resolve();
    }, { once: true }));
  }]]), silent, options, () => now);
  const work = engine.runOnce();
  while (engine.activeCount === 0) await new Promise((resolve) => setImmediate(resolve));
  engine.abortActive();
  await work;
  assert.equal(observedAbort, true);
});
