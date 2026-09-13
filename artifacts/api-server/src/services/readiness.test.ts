import assert from "node:assert/strict";
import test from "node:test";
import {
  createPostgresReadinessCheck,
  createReadinessService,
  readReadinessTimeoutMs,
  readinessHttpResult,
  type ReadinessTimer,
} from "./readiness.ts";

const immediateTimer: ReadinessTimer = {
  set(callback) {
    callback();
    return 1 as unknown as ReturnType<typeof setTimeout>;
  },
  clear() {},
};

test("readiness succeeds only after the database check succeeds", async () => {
  let calls = 0;
  const readiness = createReadinessService({
    timeoutMs: 500,
    async checkDatabase() {
      calls += 1;
    },
  });

  assert.equal(await readiness.check(), true);
  assert.equal(calls, 1);
});

test("readiness caches opaque results briefly to prevent public probe amplification", async () => {
  let calls = 0;
  let clock = 1_000;
  const readiness = createReadinessService({
    timeoutMs: 500,
    cacheTtlMs: 1_000,
    now: () => clock,
    async checkDatabase() {
      calls += 1;
    },
  });

  for (let index = 0; index < 25; index += 1) {
    assert.equal(await readiness.check(), true);
  }
  assert.equal(calls, 1);
  clock += 999;
  assert.equal(await readiness.check(), true);
  assert.equal(calls, 1);
  clock += 1;
  assert.equal(await readiness.check(), true);
  assert.equal(calls, 2);
});

test("drain invalidates a cached success and aborts the active probe", async () => {
  let observedSignal: AbortSignal | undefined;
  let rejectCheck: ((reason: Error) => void) | undefined;
  const readiness = createReadinessService({
    timeoutMs: 500,
    checkDatabase(signal) {
      observedSignal = signal;
      return new Promise((_resolve, reject) => {
        rejectCheck = reject;
        signal.addEventListener("abort", () => reject(new Error("draining")), { once: true });
      });
    },
  });

  const pending = readiness.check();
  await Promise.resolve();
  readiness.beginDrain();
  assert.equal(observedSignal?.aborted, true);
  rejectCheck?.(new Error("draining"));
  assert.equal(await pending, false);
  assert.equal(await readiness.check(), false);
});

test("readiness fails closed when the database check rejects", async () => {
  const readiness = createReadinessService({
    timeoutMs: 500,
    async checkDatabase() {
      throw new Error("sensitive database detail");
    },
  });

  assert.equal(await readiness.check(), false);
});

test("readiness timeout is deterministic and reuses an in-flight database check", async () => {
  let calls = 0;
  const readiness = createReadinessService({
    timeoutMs: 100,
    timer: immediateTimer,
    checkDatabase() {
      calls += 1;
      return new Promise<void>(() => undefined);
    },
  });

  assert.equal(await readiness.check(), false);
  assert.equal(await readiness.check(), false);
  assert.equal(calls, 1, "timed-out probes must not accumulate pending database checks");
});

test("draining makes readiness fail without probing while liveness remains independent", async () => {
  let calls = 0;
  const readiness = createReadinessService({
    timeoutMs: 500,
    async checkDatabase() {
      calls += 1;
    },
  });
  readiness.beginDrain();

  assert.equal(readiness.isDraining(), true);
  assert.equal(await readiness.check(), false);
  assert.equal(calls, 0);
});

test("timeout aborts an active PostgreSQL probe and destroys its client", async () => {
  let destroyed: boolean | undefined;
  let queryStarted = false;
  let rejectQuery: ((reason: Error) => void) | undefined;
  const checkDatabase = createPostgresReadinessCheck({
    async connect() {
      return {
        query() {
          queryStarted = true;
          return new Promise((_resolve, reject) => {
            rejectQuery = reject;
          });
        },
        release(destroy) {
          destroyed = destroy;
          if (destroy) rejectQuery?.(new Error("connection destroyed"));
        },
      };
    },
  });
  const readiness = createReadinessService({
    timeoutMs: 100,
    timer: immediateTimer,
    checkDatabase,
  });

  assert.equal(await readiness.check(), false);
  assert.equal(queryStarted, false, "an already-aborted probe must not start a query");
  assert.equal(destroyed, false, "an acquired but unused client can be safely released");
});

test("abort during an active PostgreSQL query destroys the connection exactly once", async () => {
  let releaseCalls = 0;
  let destroyed: boolean | undefined;
  let startQuery: (() => void) | undefined;
  let rejectQuery: ((reason: Error) => void) | undefined;
  const queryStarted = new Promise<void>((resolve) => {
    startQuery = resolve;
  });
  const checkDatabase = createPostgresReadinessCheck({
    async connect() {
      return {
        query() {
          startQuery?.();
          return new Promise((_resolve, reject) => {
            rejectQuery = reject;
          });
        },
        release(destroy) {
          releaseCalls += 1;
          destroyed = destroy;
          if (destroy) rejectQuery?.(new Error("connection destroyed"));
        },
      };
    },
  });
  const controller = new AbortController();
  const pending = checkDatabase(controller.signal);
  await queryStarted;
  controller.abort();

  await assert.rejects(pending);
  assert.equal(destroyed, true);
  assert.equal(releaseCalls, 1);
});

test("a timed-out pool acquisition stays shared and does not accumulate waiters", async () => {
  let calls = 0;
  const readiness = createReadinessService({
    timeoutMs: 100,
    timer: immediateTimer,
    checkDatabase() {
      calls += 1;
      return new Promise<void>(() => undefined);
    },
  });

  await Promise.all(Array.from({ length: 25 }, () => readiness.check()));
  assert.equal(calls, 1);
});

test("readiness timeout configuration is bounded and fails startup on invalid values", () => {
  assert.equal(readReadinessTimeoutMs(undefined), 1_000);
  assert.equal(readReadinessTimeoutMs("100"), 100);
  assert.equal(readReadinessTimeoutMs("5000"), 5_000);
  assert.throws(() => readReadinessTimeoutMs("99"));
  assert.throws(() => readReadinessTimeoutMs("5001"));
  assert.throws(() => readReadinessTimeoutMs("1s"));
});

test("readyz response contract is opaque and fail-closed", () => {
  assert.deepEqual(readinessHttpResult(false), {
    statusCode: 503,
    body: { status: "not_ready" },
  });
  assert.deepEqual(readinessHttpResult(true), {
    statusCode: 200,
    body: { status: "ready" },
  });
});
