import assert from "node:assert/strict";
import test from "node:test";
import { HealthServer } from "./health.ts";
import type { SafeLogger, WorkerRepository } from "./types.ts";

const silent: SafeLogger = { info() {}, warn() {}, error() {} };

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
    buildUserExportSnapshot: async () => ({ schemaVersion: 1, subjectId: "unused", requestedAt: new Date(0).toISOString(), datasets: {} }),
    recordDataRequestStep: async () => undefined,
    listUserExportObjects: async () => [],
    recordExportObjectsRevoked: async () => undefined,
    revokeUserAccess: async () => ({ clerkSubject: "unused", revenueCatCustomerId: "unused" }),
    eraseUserData: async () => undefined,
    completeDataRequest: async () => true,
    ...overrides,
  };
}

test("health separates liveness, readiness, degradation and shutdown", async () => {
  let shuttingDown = false;
  let deadLettered = 2;
  const repo = repository({ deadLetterCount: async () => deadLettered });
  const health = new HealthServer(
    repo,
    3,
    ["billing.restore_requested.v1"],
    () => shuttingDown,
    silent,
  );
  const port = await health.listen(0);
  try {
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "live" });

    const degraded = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(degraded.status, 200);
    assert.deepEqual(await degraded.json(), { status: "degraded", deadLettered: 2 });

    deadLettered = 0;
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    shuttingDown = true;
    assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 503);
  } finally {
    await health.close();
  }
});

test("readiness fails closed when PostgreSQL is unavailable", async () => {
  const health = new HealthServer(
    repository({ ping: async () => { throw new Error("database unavailable"); } }),
    3,
    ["billing.restore_requested.v1"],
    () => false,
    silent,
  );
  const port = await health.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
  } finally {
    await health.close();
  }
});
