import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import {
  expectedConfirmation,
  inspectDeadLetter,
  listDeadLetters,
  requeueDeadLetter,
} from "./dead-letter-core.mjs";

const enabled = process.env.RUN_DEAD_LETTER_OPS_POSTGRES_TESTS === "true";
const rawUrl = process.env.OPS_TEST_DATABASE_URL ?? "";
const expectedDatabaseName = process.env.OPS_TEST_EXPECTED_DATABASE_NAME ?? "";
let safeUrl = false;
try {
  const parsed = new URL(rawUrl);
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]).has(parsed.hostname);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const exactExpectedDatabase = expectedDatabaseName !== "" && databaseName === expectedDatabaseName;
  const testDatabase = databaseName.toLowerCase().includes("test");
  safeUrl = new Set(["postgres:", "postgresql:"]).has(parsed.protocol)
    && !parsed.hash && !parsed.search && loopback && testDatabase && exactExpectedDatabase;
} catch {
  safeUrl = false;
}

test("opt-in PostgreSQL fencing, redaction and audit contract", { skip: !enabled || !safeUrl }, async (context) => {
  let pg;
  try {
    const requireFromWorker = createRequire(new URL("../../artifacts/worker/package.json", import.meta.url));
    pg = requireFromWorker("pg");
  } catch {
    context.skip("pg dependency is unavailable; run the workspace install first");
    return;
  }

  const client = new pg.Client({ connectionString: rawUrl, application_name: "ia-aprova-dead-letter-ops-test" });
  await client.connect();
  try {
    await client.query("SET search_path TO pg_temp");
    await client.query(`CREATE TEMP TABLE outbox_events (
      id uuid PRIMARY KEY, aggregate_type text NOT NULL, aggregate_id text NOT NULL,
      event_type text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL,
      available_at timestamptz NOT NULL, processed_at timestamptz, attempts integer NOT NULL
    )`);
    await client.query(`CREATE TEMP TABLE audit_logs (
      id uuid PRIMARY KEY, actor_type text NOT NULL, actor_id text, action text NOT NULL,
      resource_type text NOT NULL, resource_id text NOT NULL, request_id text,
      before jsonb, after jsonb, created_at timestamptz NOT NULL
    )`);
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO outbox_events VALUES ($1, 'data_request', 'private-aggregate',
       'privacy.export_requested.v1', $2::jsonb, now(), now(), NULL, 12)`,
      [eventId, JSON.stringify({ userId: "private-user", email: "private@example.com" })],
    );
    const queryable = { query: client.query.bind(client) };
    const listed = await listDeadLetters(queryable, { maxAttempts: 12, limit: 10 });
    assert.equal(listed.count, 1);
    assert.doesNotMatch(JSON.stringify(listed), /private/);
    const inspected = await inspectDeadLetter(queryable, { eventId, maxAttempts: 12 });
    assert.doesNotMatch(JSON.stringify(inspected), /private|example\.com|email/);

    const base = {
      eventId,
      eventType: "privacy.export_requested.v1",
      expectedAttempts: 12,
      maxAttempts: 12,
      operatorId: "op_integration1",
      reasonCode: "reason_integration_test",
      environment: "development",
      changeTicket: "TEST-1",
    };
    const pool = {
      async connect() {
        return { query: client.query.bind(client), release() {} };
      },
    };
    const first = await requeueDeadLetter(pool, { ...base, confirmation: expectedConfirmation(base) });
    const second = await requeueDeadLetter(pool, { ...base, confirmation: expectedConfirmation(base) });
    assert.equal(first.status, "requeued");
    assert.equal(second.status, "already_requeued");
    const event = await client.query("SELECT attempts, processed_at FROM outbox_events WHERE id = $1", [eventId]);
    assert.equal(event.rows[0].attempts, 0);
    assert.equal(event.rows[0].processed_at, null);
    const audit = await client.query("SELECT actor_id, before, after FROM audit_logs WHERE resource_id = $1", [eventId]);
    assert.equal(audit.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(audit.rows), /private|payload|example\.com/);
  } finally {
    await client.end();
  }
});
