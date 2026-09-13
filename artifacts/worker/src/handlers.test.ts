import assert from "node:assert/strict";
import test from "node:test";
import { DeferredWorkerError, InvalidEventError, RetryableWorkerError } from "./errors.ts";
import { createHandlerRegistry } from "./handlers.ts";
import type { OutboxEvent, PrivacyAdapter, WorkerRepository } from "./types.ts";

const eventId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const appUserId = "21000000-0000-4000-8000-000000000002";
const requestId = "30000000-0000-4000-8000-000000000003";
const occurredAt = new Date("2026-08-20T12:00:00.000Z");

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: eventId,
    aggregateType: "billing_restore",
    aggregateId: userId,
    eventType: "billing.restore_requested.v1",
    payload: { userId, appUserId, provider: "revenuecat" },
    occurredAt,
    availableAt: occurredAt,
    processedAt: null,
    attempts: 1,
    ...overrides,
  };
}

function repository(overrides: Partial<WorkerRepository> = {}): WorkerRepository {
  return {
    claimBatch: async () => [],
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
    buildUserExportSnapshot: async () => ({ schemaVersion: 1, subjectId: userId, requestedAt: occurredAt.toISOString(), datasets: {} }),
    recordDataRequestStep: async () => undefined,
    listUserExportObjects: async () => [],
    recordExportObjectsRevoked: async () => undefined,
    revokeUserAccess: async () => ({ clerkSubject: "user_test", revenueCatCustomerId: "user_test" }),
    eraseUserData: async () => undefined,
    completeDataRequest: async () => true,
    ...overrides,
  };
}

test("billing restore persists only the server-authoritative allowlisted state", async () => {
  const capture: { reconciled: Parameters<WorkerRepository["reconcileProEntitlement"]>[0] | null } = { reconciled: null };
  const repo = repository({ reconcileProEntitlement: async (input) => { capture.reconciled = input; return true; } });
  const handlers = createHandlerRegistry({
    repository: repo,
    privacyAdapter: null,
    revenueCat: { environment: "production", lookupPro: async () => ({
      active: true,
      entitlementKey: "pro",
      productSku: "iaaprova.pro.monthly",
      store: "APP_STORE",
      environment: "production",
      startsAt: occurredAt,
      expiresAt: new Date("2026-09-20T12:00:00.000Z"),
    }) },
  });
  await handlers.get("billing.restore_requested.v1")!(event(), { signal: new AbortController().signal });
  assert.equal(capture.reconciled?.userId, userId);
  assert.equal(capture.reconciled?.state.active, true);
  assert.equal(capture.reconciled?.state.productSku, "iaaprova.pro.monthly");
});

test("missing RevenueCat configuration retries and never changes entitlement", async () => {
  let writes = 0;
  const handlers = createHandlerRegistry({
    repository: repository({ reconcileProEntitlement: async () => { writes += 1; return true; } }),
    privacyAdapter: null,
    revenueCat: null,
  });
  await assert.rejects(
    handlers.get("billing.restore_requested.v1")!(event(), { signal: new AbortController().signal }),
    RetryableWorkerError,
  );
  assert.equal(writes, 0);
});

test("privacy request stays pending when no real adapter exists", async () => {
  let completed = 0;
  const repo = repository({
    getDataRequest: async () => ({ id: requestId, userId, kind: "export", status: "pending", phase: "requested", requestedAt: occurredAt }),
    completeDataRequest: async () => { completed += 1; return true; },
  });
  const handler = createHandlerRegistry({ repository: repo, privacyAdapter: null, revenueCat: null })
    .get("privacy.export_requested.v1")!;
  await assert.rejects(handler(event({
    aggregateType: "data_request",
    aggregateId: requestId,
    eventType: "privacy.export_requested.v1",
    payload: { userId, dataRequestId: requestId },
  }), { signal: new AbortController().signal }), /privacy_export_adapter_unavailable/);
  assert.equal(completed, 0);
});

test("privacy completion happens only after the idempotent adapter succeeds", async () => {
  const calls: string[] = [];
  const adapter: PrivacyAdapter = {
    exportUserData: async ({ requestId: id }) => { calls.push(`adapter:${id}`); },
    deleteUserData: async () => { throw new Error("not used"); },
  };
  const repo = repository({
    getDataRequest: async () => ({ id: requestId, userId, kind: "export", status: "pending", phase: "requested", requestedAt: occurredAt }),
    completeDataRequest: async ({ requestId: id }) => { calls.push(`complete:${id}`); return true; },
  });
  const handler = createHandlerRegistry({ repository: repo, privacyAdapter: adapter, revenueCat: null })
    .get("privacy.export_requested.v1")!;
  await handler(event({
    aggregateType: "data_request",
    aggregateId: requestId,
    eventType: "privacy.export_requested.v1",
    payload: { userId, dataRequestId: requestId },
  }), { signal: new AbortController().signal });
  assert.deepEqual(calls, [`adapter:${requestId}`, `complete:${requestId}`]);
});

test("simulation deadline accepts only the minimized envelope and delegates no score or answers", async () => {
  const captured: Array<Parameters<WorkerRepository["finalizeSimulationDeadline"]>[0]> = [];
  const repo = repository({
    finalizeSimulationDeadline: async (input) => {
      captured.push(input);
      return { status: "finalized", resultHash: "a".repeat(64) };
    },
  });
  const handler = createHandlerRegistry({ repository: repo, privacyAdapter: null, revenueCat: null })
    .get("simulation.deadline_reached.v1")!;
  const deadlineAt = "2026-08-20T13:00:00.000Z";
  await handler(event({
    aggregateType: "simulation",
    aggregateId: requestId,
    eventType: "simulation.deadline_reached.v1",
    payload: { simulationId: requestId, deadlineAt },
  }), { signal: new AbortController().signal });
  assert.deepEqual(captured, [{
    simulationId: requestId,
    expectedDeadlineAt: new Date(deadlineAt),
    eventId,
  }]);

  for (const payload of [
    { simulationId: requestId, deadlineAt, score: 100 },
    { simulationId: requestId, deadlineAt, answers: [] },
    { simulationId: requestId },
  ]) {
    await assert.rejects(handler(event({
      aggregateType: "simulation",
      aggregateId: requestId,
      eventType: "simulation.deadline_reached.v1",
      payload,
    }), { signal: new AbortController().signal }), InvalidEventError);
  }
  assert.equal(captured.length, 1);
});

test("simulation deadline fails closed on forged aggregate, timestamp and repository corruption", async () => {
  let calls = 0;
  const handler = createHandlerRegistry({
    repository: repository({
      finalizeSimulationDeadline: async () => {
        calls += 1;
        return { status: "invalid", code: "simulation_state_invalid" };
      },
    }),
    privacyAdapter: null,
    revenueCat: null,
  }).get("simulation.deadline_reached.v1")!;
  const base = {
    aggregateType: "simulation",
    aggregateId: requestId,
    eventType: "simulation.deadline_reached.v1" as const,
    payload: { simulationId: requestId, deadlineAt: "2026-08-20T13:00:00.000Z" },
  };
  await assert.rejects(handler(event({ ...base, aggregateId: userId }), {
    signal: new AbortController().signal,
  }), /simulation_deadline_payload_invalid/);
  await assert.rejects(handler(event({ ...base, payload: { ...base.payload, deadlineAt: "2026-08-20T13:00:00Z" } }), {
    signal: new AbortController().signal,
  }), /simulation_deadline_invalid/);
  await assert.rejects(handler(event({ ...base, payload: { ...base.payload, deadlineAt: "2026-08-28T13:00:00.000Z" } }), {
    signal: new AbortController().signal,
  }), /simulation_deadline_payload_invalid/);
  await assert.rejects(handler(event(base), { signal: new AbortController().signal }), /simulation_state_invalid/);
  assert.equal(calls, 1);
});

test("simulation deadline reschedules exactly, while a deleted DSR subject is an idempotent no-op", async () => {
  const deadlineAt = new Date("2026-08-20T13:00:00.000Z");
  const simulationEvent = event({
    aggregateType: "simulation",
    aggregateId: requestId,
    eventType: "simulation.deadline_reached.v1",
    payload: { simulationId: requestId, deadlineAt: deadlineAt.toISOString() },
  });
  const deferred = createHandlerRegistry({
    repository: repository({ finalizeSimulationDeadline: async () => ({ status: "not_due", deadlineAt }) }),
    privacyAdapter: null,
    revenueCat: null,
  }).get("simulation.deadline_reached.v1")!;
  await assert.rejects(
    deferred(simulationEvent, { signal: new AbortController().signal }),
    (error) => error instanceof DeferredWorkerError
      && error.code === "simulation_deadline_not_due"
      && error.availableAt.getTime() === deadlineAt.getTime(),
  );

  const missing = createHandlerRegistry({
    repository: repository({ finalizeSimulationDeadline: async () => ({ status: "missing" }) }),
    privacyAdapter: null,
    revenueCat: null,
  }).get("simulation.deadline_reached.v1")!;
  await missing(simulationEvent, { signal: new AbortController().signal });
});
