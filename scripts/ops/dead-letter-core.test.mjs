import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  INSPECT_SQL,
  LIST_SQL,
  OpsError,
  REQUEUE_AUDIT_SQL,
  REQUEUE_EXISTING_AUDIT_SQL,
  REQUEUE_LOCK_SQL,
  REQUEUE_SELECT_SQL,
  REQUEUE_UPDATE_SQL,
  expectedConfirmation,
  guardConnectionEnvironment,
  inspectDeadLetter,
  listDeadLetters,
  previewRequeue,
  redactPayload,
  requeueDeadLetter,
  requeueRequestId,
  validateConfiguredMaxAttempts,
  validateMaxAttempts,
  validateRequeueInput,
} from "./dead-letter-core.mjs";

const EVENT_ID = "a0c7d241-2e40-4b42-8eb8-2a1a77c985d0";
const NOW = new Date("2026-08-23T12:00:00.000Z");

function environment(overrides = {}) {
  return {
    OPS_DATABASE_URL: "postgresql://db.internal/ia_aprova",
    OPS_ENVIRONMENT: "staging",
    OPS_ALLOWED_ENVIRONMENTS: "staging",
    OPS_ALLOWED_DB_HOSTS: "db.internal",
    OPS_ALLOWED_DB_NAMES: "ia_aprova",
    OPS_WORKER_MAX_ATTEMPTS: "12",
    OPS_AUTHORIZED: "false",
    ...overrides,
  };
}

function input(overrides = {}) {
  const base = {
    eventId: EVENT_ID,
    eventType: "privacy.export_requested.v1",
    expectedAttempts: 12,
    maxAttempts: 12,
    operatorId: "op_rotation7",
    reasonCode: "reason_adapter_restored",
    environment: "staging",
    changeTicket: "CHG-1042",
  };
  return { ...base, confirmation: expectedConfirmation(base), ...overrides };
}

function row(overrides = {}) {
  return {
    id: EVENT_ID,
    eventType: "privacy.export_requested.v1",
    attempts: 12,
    occurredAt: new Date("2026-08-22T10:00:00.000Z"),
    availableAt: new Date("2026-08-23T10:00:00.000Z"),
    processedAt: null,
    leaseAvailable: true,
    ...overrides,
  };
}

function expectOpsError(fn, code) {
  assert.throws(fn, (error) => error instanceof OpsError && error.code === code);
}

test("connection guard fails closed on missing URL and exact allowlists", () => {
  expectOpsError(() => guardConnectionEnvironment({}), "ops_database_url_required");
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_ALLOWED_DB_HOSTS: "*" })),
    "ops_host_allowlist_required",
  );
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_ALLOWED_DB_HOSTS: "other.internal" })),
    "ops_database_host_not_allowed",
  );
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_ALLOWED_ENVIRONMENTS: "production" })),
    "ops_environment_not_allowed",
  );
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_ALLOWED_DB_NAMES: "other_database" })),
    "ops_database_name_not_allowed",
  );
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_DATABASE_URL: "postgresql://db.internal/ia_aprova?options=-csearch_path%3Dpublic" })),
    "ops_database_url_invalid",
  );
});

test("production and every write require authorization and a change ticket", () => {
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_ENVIRONMENT: "production", OPS_ALLOWED_ENVIRONMENTS: "production" })),
    "production_authorization_required",
  );
  expectOpsError(
    () => guardConnectionEnvironment(environment(), { write: true }),
    "write_authorization_required",
  );
  expectOpsError(
    () => guardConnectionEnvironment(environment({ OPS_AUTHORIZED: "true" }), { write: true }),
    "write_change_ticket_required",
  );
  const result = guardConnectionEnvironment(environment({
    OPS_ENVIRONMENT: "production",
    OPS_ALLOWED_ENVIRONMENTS: "production",
    OPS_AUTHORIZED: "true",
    OPS_CHANGE_TICKET: "CHG-1042",
  }), { write: true });
  assert.equal(result.environment, "production");
  assert.equal(result.hostname, "db.internal");
  assert.equal(result.databaseName, "ia_aprova");
  assert.equal(result.workerMaxAttempts, 12);
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(result.databaseUrl, "postgresql://db.internal/ia_aprova");
  assert.doesNotMatch(JSON.stringify(result), /postgresql:\/\/|password|secret|@/i);
});

test("configured worker threshold cannot be lowered or expressed ambiguously", () => {
  assert.equal(validateConfiguredMaxAttempts("12", 12), 12);
  expectOpsError(() => validateConfiguredMaxAttempts("1", 12), "max_attempts_configuration_mismatch");
  expectOpsError(() => validateMaxAttempts("1e1"), "max_attempts_invalid");
  expectOpsError(() => validateMaxAttempts("012"), "max_attempts_invalid");
  expectOpsError(() => validateMaxAttempts(" 12 "), "max_attempts_invalid");
});

test("requeue input requires pseudonymous operator, reason and exact confirmation", () => {
  expectOpsError(() => validateRequeueInput(input({ operatorId: "person@example.com" })), "operator_id_must_be_pseudonymous");
  expectOpsError(() => validateRequeueInput(input({ reasonCode: "because I said so" })), "reason_code_invalid");
  expectOpsError(() => validateRequeueInput(input({ confirmation: "yes" })), "strong_confirmation_mismatch");
  expectOpsError(() => validateRequeueInput(input({ expectedAttempts: 11 })), "event_not_dead_letter_eligible");
  assert.equal(validateRequeueInput(input()).eventId, EVENT_ID);
  assert.equal(validateRequeueInput(input({
    eventType: "simulation.deadline_reached.v1",
    confirmation: expectedConfirmation({
      ...input(),
      eventType: "simulation.deadline_reached.v1",
    }),
  })).eventType, "simulation.deadline_reached.v1");
});

test("strong confirmation binds threshold, operator and reason", () => {
  const original = input();
  expectOpsError(
    () => validateRequeueInput({ ...original, maxAttempts: 11 }),
    "strong_confirmation_mismatch",
  );
  expectOpsError(
    () => validateRequeueInput({ ...original, operatorId: "op_rotation8" }),
    "strong_confirmation_mismatch",
  );
  expectOpsError(
    () => validateRequeueInput({ ...original, reasonCode: "reason_other_safe_code" }),
    "strong_confirmation_mismatch",
  );
});

test("redaction never emits payload values or unknown field names", () => {
  const output = redactPayload({
    userId: "real-user-id",
    provider: "revenuecat",
    email: "person@example.com",
    nestedSecret: { card: "4111111111111111" },
  });
  const serialized = JSON.stringify(output);
  assert.match(serialized, /\[REDACTED\]/);
  assert.doesNotMatch(serialized, /real-user-id|revenuecat|person@example|411111|email|nestedSecret/);
  assert.equal(output.unknownFieldCount, 2);
});

test("list SQL selects only allowlisted metadata and result omits payload", async () => {
  assert.doesNotMatch(LIST_SQL, /payload|aggregate_id|aggregate_type/i);
  assert.match(LIST_SQL, /available_at <= CURRENT_TIMESTAMP/);
  const queryable = {
    async query(sql, parameters) {
      assert.equal(sql, LIST_SQL);
      assert.equal(parameters[0], 12);
      assert.equal(parameters[2], 10);
      return { rows: [{ ...row(), payload: { email: "must-not-leak" } }] };
    },
  };
  const result = await listDeadLetters(queryable, { maxAttempts: 12, limit: 10 });
  assert.equal(result.count, 1);
  assert.equal(Object.hasOwn(result.events[0], "payload"), false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
});

test("inspection reads one eligible event and always redacts payload", async () => {
  assert.match(INSPECT_SQL, /WHERE id = \$1/);
  assert.match(INSPECT_SQL, /attempts >= \$2/);
  assert.match(INSPECT_SQL, /available_at <= CURRENT_TIMESTAMP/);
  const queryable = {
    async query(sql, parameters) {
      assert.equal(sql, INSPECT_SQL);
      assert.equal(parameters[0], EVENT_ID);
      assert.equal(parameters[1], 12);
      assert.equal(parameters[2].includes("privacy.export_requested.v1"), true);
      return { rows: [{ ...row(), payload: { userId: "private", email: "private@example.com" } }] };
    },
  };
  const result = await inspectDeadLetter(queryable, { eventId: EVENT_ID, maxAttempts: 12 });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, "ok");
  assert.doesNotMatch(serialized, /private|example\.com|email/);
});

test("an active final attempt is not treated as a dead-letter", async () => {
  const queryable = { async query() { return { rows: [row({ leaseAvailable: false })] }; } };
  await assert.rejects(
    () => previewRequeue(queryable, input()),
    (error) => error instanceof OpsError && error.code === "event_active_or_leased",
  );
});

test("dry-run validates fences and does not issue update or audit", async () => {
  const queries = [];
  const queryable = {
    async query(sql) {
      queries.push(sql);
      return { rows: [row()] };
    },
  };
  const result = await previewRequeue(queryable, input());
  assert.equal(result.status, "eligible");
  assert.equal(result.dryRun, true);
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /UPDATE|INSERT/i);
});

test("requeue is fenced, audited without payload and commits atomically", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql === REQUEUE_EXISTING_AUDIT_SQL) return { rows: [] };
      if (sql === REQUEUE_SELECT_SQL) return { rows: [row()] };
      if (sql === REQUEUE_UPDATE_SQL) return { rows: [row({ attempts: 0, availableAt: NOW })] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  const result = await requeueDeadLetter({ async connect() { return client; } }, input(), {
    now: NOW,
    auditId: "7ee8bb5a-81d2-4d76-9d2a-323348981b3f",
  });
  assert.deepEqual(result, { status: "requeued", eventId: EVENT_ID, attempts: 0 });
  assert.equal(released, true);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls[1].sql, REQUEUE_LOCK_SQL);
  assert.equal(calls.at(-1).sql, "COMMIT");
  const update = calls.find((call) => call.sql === REQUEUE_UPDATE_SQL);
  assert.deepEqual(update.parameters.slice(0, 4), [EVENT_ID, input().eventType, 12, 12]);
  assert.match(REQUEUE_UPDATE_SQL, /available_at <= CURRENT_TIMESTAMP/);
  const audit = calls.find((call) => call.sql === REQUEUE_AUDIT_SQL);
  assert.ok(audit);
  assert.equal(audit.parameters[1], "op_rotation7");
  assert.equal(audit.parameters[3], requeueRequestId(input()));
  assert.doesNotMatch(JSON.stringify(audit.parameters), /payload|userId|private@example/);
  assert.match(audit.parameters[4], /reason_adapter_restored/);
  assert.match(audit.parameters[4], /CHG-1042/);
});

test("request identity changes with every forensic input", () => {
  const original = requeueRequestId(input());
  for (const changed of [
    input({ environment: "production", confirmation: input().confirmation }),
    input({ maxAttempts: 11, confirmation: input().confirmation }),
    input({ reasonCode: "reason_changed", confirmation: input().confirmation }),
    input({ operatorId: "op_rotation8", confirmation: input().confirmation }),
    input({ changeTicket: "CHG-1043", confirmation: input().confirmation }),
  ]) {
    assert.notEqual(requeueRequestId(changed), original);
  }
});

test("same event, attempts and ticket is idempotent", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === REQUEUE_EXISTING_AUDIT_SQL) return { rows: [{ exists: 1 }] };
      return { rows: [] };
    },
    release() {},
  };
  const result = await requeueDeadLetter({ async connect() { return client; } }, input());
  assert.deepEqual(result, { status: "already_requeued", eventId: EVENT_ID });
  assert.equal(calls.includes(REQUEUE_UPDATE_SQL), false);
  assert.equal(calls.includes(REQUEUE_AUDIT_SQL), false);
  assert.equal(calls.at(-1), "COMMIT");
});

test("a concurrency or expectation conflict rolls back without audit", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === REQUEUE_EXISTING_AUDIT_SQL) return { rows: [] };
      if (sql === REQUEUE_SELECT_SQL) return { rows: [row({ attempts: 13 })] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => requeueDeadLetter({ async connect() { return client; } }, input()),
    (error) => error instanceof OpsError && error.code === "event_attempts_conflict",
  );
  assert.equal(calls.includes(REQUEUE_UPDATE_SQL), false);
  assert.equal(calls.includes(REQUEUE_AUDIT_SQL), false);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("a processed event rolls back without update or audit", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === REQUEUE_EXISTING_AUDIT_SQL) return { rows: [] };
      if (sql === REQUEUE_SELECT_SQL) return { rows: [row({ processedAt: NOW })] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => requeueDeadLetter({ async connect() { return client; } }, input()),
    (error) => error instanceof OpsError && error.code === "event_already_processed",
  );
  assert.equal(calls.includes(REQUEUE_UPDATE_SQL), false);
  assert.equal(calls.includes(REQUEUE_AUDIT_SQL), false);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("a database update fence rejection rolls back before audit", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === REQUEUE_EXISTING_AUDIT_SQL) return { rows: [] };
      if (sql === REQUEUE_SELECT_SQL) return { rows: [row()] };
      if (sql === REQUEUE_UPDATE_SQL) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    () => requeueDeadLetter({ async connect() { return client; } }, input()),
    (error) => error instanceof OpsError && error.code === "event_fence_rejected",
  );
  assert.equal(calls.includes(REQUEUE_AUDIT_SQL), false);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("an audit failure rolls the event update back in the same transaction", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === REQUEUE_EXISTING_AUDIT_SQL) return { rows: [] };
      if (sql === REQUEUE_SELECT_SQL) return { rows: [row()] };
      if (sql === REQUEUE_UPDATE_SQL) return { rows: [row({ attempts: 0 })] };
      if (sql === REQUEUE_AUDIT_SQL) throw new Error("synthetic audit failure");
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(() => requeueDeadLetter({ async connect() { return client; } }, input()));
  assert.equal(calls.includes(REQUEUE_UPDATE_SQL), true);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.includes("COMMIT"), false);
});

test("CLI rejects a repeated execute flag before reading environment or connecting", () => {
  const result = spawnSync(process.execPath, [
    "scripts/ops/dead-letter.mjs", "requeue", "--execute", "--execute",
  ], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /"code":"argument_duplicate"/);
  assert.doesNotMatch(result.stderr, /postgres|database_url/);
});
