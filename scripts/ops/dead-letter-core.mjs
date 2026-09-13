import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

export const SUPPORTED_EVENT_TYPES = Object.freeze([
  "billing.restore_requested.v1",
  "privacy.export_requested.v1",
  "privacy.deletion_requested.v1",
  "simulation.deadline_reached.v1",
]);

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATOR_PATTERN = /^op_[a-z0-9][a-z0-9_-]{2,60}$/;
const REASON_PATTERN = /^reason_[a-z0-9][a-z0-9._-]{2,56}$/;
const CHANGE_TICKET_PATTERN = /^[A-Z][A-Z0-9]{1,15}-[0-9]{1,12}$/;
const ENVIRONMENTS = new Set(["development", "staging", "production"]);
const SAFE_PAYLOAD_FIELDS = new Set([
  "userId", "provider", "dataRequestId", "simulationId", "deadlineAt",
]);

export class OpsError extends Error {
  constructor(code) {
    super(code);
    this.name = "OpsError";
    this.code = code;
  }
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw new OpsError(code);
  return value.trim();
}

function exactCsv(value, code) {
  const entries = required(value, code).split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.some((entry) => entry === "" || entry === "*")) throw new OpsError(code);
  return new Set(entries);
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value === "string" && !/^[1-9][0-9]*$/.test(value)) throw new OpsError(code);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new OpsError(code);
  return parsed;
}

function databaseNameFromUrl(databaseUrl) {
  let databaseName;
  try {
    databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  } catch {
    throw new OpsError("ops_database_name_invalid");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(databaseName)) {
    throw new OpsError("ops_database_name_invalid");
  }
  return databaseName;
}

/**
 * Fail-closed connection guard. The URL remains available only as a
 * non-enumerable property so ordinary JSON output cannot serialize it.
 */
export function guardConnectionEnvironment(env, { write = false } = {}) {
  const rawUrl = required(env.OPS_DATABASE_URL, "ops_database_url_required");
  let databaseUrl;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new OpsError("ops_database_url_invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
    throw new OpsError("ops_database_protocol_invalid");
  }
  if (databaseUrl.hash || databaseUrl.search || !databaseUrl.hostname || databaseUrl.pathname === "/") {
    throw new OpsError("ops_database_url_invalid");
  }

  const environment = required(env.OPS_ENVIRONMENT, "ops_environment_required").toLowerCase();
  if (!ENVIRONMENTS.has(environment)) throw new OpsError("ops_environment_invalid");
  const allowedEnvironments = exactCsv(env.OPS_ALLOWED_ENVIRONMENTS, "ops_environment_allowlist_required");
  if (!allowedEnvironments.has(environment)) throw new OpsError("ops_environment_not_allowed");

  const allowedHosts = exactCsv(env.OPS_ALLOWED_DB_HOSTS, "ops_host_allowlist_required");
  const hostname = databaseUrl.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) throw new OpsError("ops_database_host_not_allowed");

  const databaseName = databaseNameFromUrl(databaseUrl);
  const allowedDatabaseNames = exactCsv(env.OPS_ALLOWED_DB_NAMES, "ops_database_name_allowlist_required");
  if (!allowedDatabaseNames.has(databaseName.toLowerCase())) {
    throw new OpsError("ops_database_name_not_allowed");
  }
  const workerMaxAttempts = validateMaxAttempts(env.OPS_WORKER_MAX_ATTEMPTS);

  const production = environment === "production";
  const authorized = env.OPS_AUTHORIZED === "true";
  const changeTicket = typeof env.OPS_CHANGE_TICKET === "string" ? env.OPS_CHANGE_TICKET.trim() : "";
  if (production && !authorized) throw new OpsError("production_authorization_required");
  if (production && !CHANGE_TICKET_PATTERN.test(changeTicket)) {
    throw new OpsError("production_change_ticket_required");
  }
  if (write && !authorized) throw new OpsError("write_authorization_required");
  if (write && !CHANGE_TICKET_PATTERN.test(changeTicket)) throw new OpsError("write_change_ticket_required");

  const result = {
    environment,
    hostname,
    databaseName,
    workerMaxAttempts,
    production,
    authorized,
    changeTicket: changeTicket || null,
  };
  Object.defineProperty(result, "databaseUrl", {
    value: rawUrl,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result);
}

export function validateEventId(value) {
  const eventId = required(value, "event_id_required").toLowerCase();
  if (!UUID_PATTERN.test(eventId)) throw new OpsError("event_id_invalid");
  return eventId;
}

export function validateMaxAttempts(value) {
  return positiveInteger(value, "max_attempts_invalid", 50);
}

export function validateConfiguredMaxAttempts(value, configuredValue) {
  const requested = validateMaxAttempts(value);
  const configured = validateMaxAttempts(configuredValue);
  if (requested !== configured) throw new OpsError("max_attempts_configuration_mismatch");
  return configured;
}

export function validateLimit(value = 25) {
  return positiveInteger(value, "limit_invalid", 100);
}

export function expectedConfirmation(input) {
  return [
    "REQUEUE",
    input.environment,
    input.eventId,
    input.eventType,
    `ATTEMPTS=${input.expectedAttempts}`,
    `THRESHOLD=${input.maxAttempts}`,
    `REASON=${input.reasonCode}`,
    `OPERATOR=${input.operatorId}`,
    `TICKET=${input.changeTicket}`,
  ].join(" ");
}

export function validateRequeueInput(input) {
  const eventId = validateEventId(input.eventId);
  const eventType = required(input.eventType, "event_type_required");
  if (!SUPPORTED_EVENT_TYPES.includes(eventType)) throw new OpsError("event_type_not_allowed");
  const expectedAttempts = positiveInteger(input.expectedAttempts, "expected_attempts_invalid", 50);
  const maxAttempts = validateMaxAttempts(input.maxAttempts);
  if (expectedAttempts < maxAttempts) throw new OpsError("event_not_dead_letter_eligible");

  const operatorId = required(input.operatorId, "operator_id_required");
  if (!OPERATOR_PATTERN.test(operatorId)) throw new OpsError("operator_id_must_be_pseudonymous");
  const reasonCode = required(input.reasonCode, "reason_code_required");
  if (!REASON_PATTERN.test(reasonCode)) throw new OpsError("reason_code_invalid");

  const environment = required(input.environment, "ops_environment_required").toLowerCase();
  if (!ENVIRONMENTS.has(environment)) throw new OpsError("ops_environment_invalid");
  const changeTicket = required(input.changeTicket, "write_change_ticket_required");
  if (!CHANGE_TICKET_PATTERN.test(changeTicket)) throw new OpsError("write_change_ticket_required");

  const confirmation = required(input.confirmation, "strong_confirmation_required");
  const normalized = {
    eventId,
    eventType,
    expectedAttempts,
    maxAttempts,
    operatorId,
    reasonCode,
    environment,
    changeTicket,
    confirmation,
  };
  if (confirmation !== expectedConfirmation(normalized)) throw new OpsError("strong_confirmation_mismatch");
  return Object.freeze(normalized);
}

/** Only allowlisted field names survive; no payload value can leave this function. */
export function redactPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Object.freeze({ kind: "non_object", value: "[REDACTED]" });
  }
  const fields = [];
  let unknownFieldCount = 0;
  for (const key of Object.keys(payload)) {
    if (SAFE_PAYLOAD_FIELDS.has(key)) fields.push(Object.freeze({ field: key, value: "[REDACTED]" }));
    else unknownFieldCount += 1;
  }
  fields.sort((left, right) => left.field.localeCompare(right.field));
  return Object.freeze({ kind: "object", fields, unknownFieldCount });
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new OpsError("database_result_invalid");
  return date.toISOString();
}

function safeMetadata(row) {
  const eventType = String(row.eventType);
  const attempts = Number(row.attempts);
  if (!SUPPORTED_EVENT_TYPES.includes(eventType) || !Number.isSafeInteger(attempts) || attempts < 0) {
    throw new OpsError("database_result_invalid");
  }
  return Object.freeze({
    id: validateEventId(row.id),
    eventType,
    attempts,
    occurredAt: iso(row.occurredAt),
    availableAt: iso(row.availableAt),
  });
}

export const LIST_SQL = `SELECT id,
       event_type AS "eventType",
       attempts,
       occurred_at AS "occurredAt",
       available_at AS "availableAt"
FROM outbox_events
WHERE processed_at IS NULL
  AND attempts >= $1
  AND available_at <= CURRENT_TIMESTAMP
  AND event_type = ANY($2::text[])
ORDER BY occurred_at ASC, id ASC
LIMIT $3`;

export const INSPECT_SQL = `SELECT id,
       event_type AS "eventType",
       attempts,
       occurred_at AS "occurredAt",
       available_at AS "availableAt",
       payload
FROM outbox_events
WHERE id = $1
  AND processed_at IS NULL
  AND attempts >= $2
  AND available_at <= CURRENT_TIMESTAMP
  AND event_type = ANY($3::text[])
LIMIT 1`;

export async function listDeadLetters(queryable, input) {
  const maxAttempts = validateMaxAttempts(input.maxAttempts);
  const limit = validateLimit(input.limit);
  const result = await queryable.query(LIST_SQL, [maxAttempts, SUPPORTED_EVENT_TYPES, limit]);
  return Object.freeze({ status: "ok", count: result.rows.length, events: result.rows.map(safeMetadata) });
}

export async function inspectDeadLetter(queryable, input) {
  const eventId = validateEventId(input.eventId);
  const maxAttempts = validateMaxAttempts(input.maxAttempts);
  const result = await queryable.query(INSPECT_SQL, [eventId, maxAttempts, SUPPORTED_EVENT_TYPES]);
  const row = result.rows[0];
  if (!row) return Object.freeze({ status: "not_found_or_not_eligible", eventId });
  return Object.freeze({
    status: "ok",
    event: Object.freeze({ ...safeMetadata(row), payload: redactPayload(row.payload) }),
  });
}

export function requeueRequestId(input) {
  return [
    "dead-letter-requeue:v2",
    input.environment,
    input.eventId,
    input.eventType,
    input.expectedAttempts,
    input.maxAttempts,
    input.reasonCode,
    input.operatorId,
    input.changeTicket,
  ].join(":");
}

export const REQUEUE_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";
export const REQUEUE_EXISTING_AUDIT_SQL = `SELECT 1
FROM audit_logs
WHERE action = 'dead_letter.requeue'
  AND resource_type = 'outbox_event'
  AND resource_id = $1
  AND request_id = $2
LIMIT 1`;
export const REQUEUE_SELECT_SQL = `SELECT id,
       event_type AS "eventType",
       attempts,
       occurred_at AS "occurredAt",
       available_at AS "availableAt",
       processed_at AS "processedAt",
       available_at <= CURRENT_TIMESTAMP AS "leaseAvailable"
FROM outbox_events
WHERE id = $1
FOR UPDATE`;
export const REQUEUE_UPDATE_SQL = `UPDATE outbox_events
SET attempts = 0,
    available_at = CURRENT_TIMESTAMP
WHERE id = $1
  AND event_type = $2
  AND attempts = $3
  AND attempts >= $4
  AND available_at <= CURRENT_TIMESTAMP
  AND processed_at IS NULL
RETURNING id,
          event_type AS "eventType",
          attempts,
          occurred_at AS "occurredAt",
          available_at AS "availableAt"`;
export const REQUEUE_AUDIT_SQL = `INSERT INTO audit_logs (
  id, actor_type, actor_id, action, resource_type, resource_id,
  request_id, before, after, created_at
) VALUES (
  $1, 'ops_operator', $2, 'dead_letter.requeue', 'outbox_event', $3,
  $4, $5::jsonb, $6::jsonb, CURRENT_TIMESTAMP
)`;

function auditSnapshot(row, extra = {}) {
  return Object.freeze({
    eventType: String(row.eventType),
    attempts: Number(row.attempts),
    processed: row.processedAt !== undefined ? row.processedAt !== null : false,
    ...extra,
  });
}

export async function previewRequeue(queryable, input) {
  const normalized = validateRequeueInput(input);
  const result = await queryable.query(REQUEUE_SELECT_SQL.replace("FOR UPDATE", ""), [normalized.eventId]);
  const row = result.rows[0];
  if (!row) return Object.freeze({ status: "not_found", eventId: normalized.eventId, dryRun: true });
  if (row.processedAt !== null) throw new OpsError("event_already_processed");
  if (row.leaseAvailable !== true) throw new OpsError("event_active_or_leased");
  if (row.eventType !== normalized.eventType) throw new OpsError("event_type_conflict");
  if (Number(row.attempts) !== normalized.expectedAttempts) throw new OpsError("event_attempts_conflict");
  if (Number(row.attempts) < normalized.maxAttempts) throw new OpsError("event_not_dead_letter_eligible");
  return Object.freeze({
    status: "eligible",
    dryRun: true,
    eventId: normalized.eventId,
    before: auditSnapshot(row),
    after: Object.freeze({ eventType: normalized.eventType, attempts: 0, processed: false }),
  });
}

/**
 * Requeue one exact event. The advisory lock makes the audit-based idempotency
 * check and the row fence serial for the event. The audit and update commit or
 * roll back together.
 */
export async function requeueDeadLetter(pool, input, options = {}) {
  const normalized = validateRequeueInput(input);
  const requestId = requeueRequestId(normalized);
  const auditId = options.auditId ?? randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(REQUEUE_LOCK_SQL, [normalized.eventId]);
    const existing = await client.query(REQUEUE_EXISTING_AUDIT_SQL, [normalized.eventId, requestId]);
    if (existing.rows.length > 0) {
      await client.query("COMMIT");
      return Object.freeze({ status: "already_requeued", eventId: normalized.eventId });
    }

    const selected = await client.query(REQUEUE_SELECT_SQL, [normalized.eventId]);
    const row = selected.rows[0];
    if (!row) throw new OpsError("event_not_found");
    if (row.processedAt !== null) throw new OpsError("event_already_processed");
    if (row.leaseAvailable !== true) throw new OpsError("event_active_or_leased");
    if (row.eventType !== normalized.eventType) throw new OpsError("event_type_conflict");
    if (Number(row.attempts) !== normalized.expectedAttempts) throw new OpsError("event_attempts_conflict");
    if (Number(row.attempts) < normalized.maxAttempts) throw new OpsError("event_not_dead_letter_eligible");

    const updated = await client.query(REQUEUE_UPDATE_SQL, [
      normalized.eventId,
      normalized.eventType,
      normalized.expectedAttempts,
      normalized.maxAttempts,
    ]);
    if (updated.rows.length !== 1) throw new OpsError("event_fence_rejected");
    const before = auditSnapshot(row, {
      reasonCode: normalized.reasonCode,
      changeTicket: normalized.changeTicket,
    });
    const after = auditSnapshot(updated.rows[0], {
      reasonCode: normalized.reasonCode,
      changeTicket: normalized.changeTicket,
    });
    await client.query(REQUEUE_AUDIT_SQL, [
      auditId,
      normalized.operatorId,
      normalized.eventId,
      requestId,
      JSON.stringify(before),
      JSON.stringify(after),
    ]);
    await client.query("COMMIT");
    return Object.freeze({ status: "requeued", eventId: normalized.eventId, attempts: 0 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createOpsPool(databaseUrl) {
  const requireFromWorker = createRequire(new URL("../../artifacts/worker/package.json", import.meta.url));
  let pg;
  try {
    pg = requireFromWorker("pg");
  } catch {
    throw new OpsError("pg_dependency_unavailable_run_workspace_install");
  }
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    application_name: "ia-aprova-dead-letter-ops",
  });
}
