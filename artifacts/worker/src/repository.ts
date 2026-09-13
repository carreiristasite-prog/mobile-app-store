import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  compileSimulationBlueprintRules,
  computeSimulationResult,
  createSimulationPresentation,
  createSimulationState,
  finishSimulationAtTime,
  submitSimulationAnswer,
  type SimulationResult,
  type SimulationSnapshot,
  type SimulationState,
} from "@workspace/simulation-engine";
import type {
  ClaimOptions,
  DataExportSnapshot,
  DataRequestRecord,
  OutboxEvent,
  WorkerRepository,
} from "./types.ts";

const { Pool } = pg;

interface OutboxRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  availableAt: Date;
  processedAt: Date | null;
  attempts: number;
}

interface SimulationSessionRow {
  id: string;
  blueprintVersionId: string;
  status: string;
  rules: unknown;
  snapshot: unknown;
  snapshotHash: string;
  state: unknown;
  result: unknown | null;
  resultHash: string | null;
  startedAt: Date;
  deadlineAt: Date;
  finalizedAt: Date | null;
  finishReason: string | null;
  observedAt: Date;
}

interface SimulationQuestionRow {
  position: number;
  questionVersionId: string;
  subjectId: string;
  optionIds: string[];
  correctOptionId: string;
}

interface SimulationAnswerRow {
  idempotencyKey: string;
  questionVersionId: string;
  selectedOptionId: string;
  receivedAt: Date;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sameDate(left: Date | null, rightMs: number | null): boolean {
  return left === null ? rightMs === null : left.getTime() === rightMs;
}

function rehydrateSimulation(
  row: SimulationSessionRow,
  questions: readonly SimulationQuestionRow[],
  answers: readonly SimulationAnswerRow[],
): { snapshot: SimulationSnapshot; state: SimulationState } | null {
  try {
    const snapshot = row.snapshot as SimulationSnapshot;
    const storedState = row.state as SimulationState;
    const rules = compileSimulationBlueprintRules(row.rules);
    createSimulationPresentation(snapshot);
    if (
      snapshot.sessionId !== row.id
      || snapshot.blueprintVersionId !== row.blueprintVersionId
      || snapshot.snapshotHash !== row.snapshotHash
      || snapshot.startedAtMs !== row.startedAt.getTime()
      || snapshot.deadlineAtMs !== row.deadlineAt.getTime()
      || canonicalJson(rules) !== canonicalJson(snapshot.rules)
    ) return null;

    const relationalQuestions = questions.map((question) => ({
      position: Number(question.position),
      questionVersionId: question.questionVersionId,
      subjectId: question.subjectId,
      optionIds: question.optionIds,
      correctOptionId: question.correctOptionId,
    }));
    if (canonicalJson(relationalQuestions) !== canonicalJson(snapshot.questions)) return null;

    let rehydrated = createSimulationState(snapshot);
    for (const answer of answers) {
      const submission = submitSimulationAnswer(snapshot, rehydrated, {
        idempotencyKey: answer.idempotencyKey,
        questionVersionId: answer.questionVersionId,
        selectedOptionId: answer.selectedOptionId,
        receivedAtMs: answer.receivedAt.getTime(),
      });
      if (submission.outcome !== "accepted") return null;
      rehydrated = submission.state;
    }
    if (row.status === "finalized" && row.finishReason === "deadline" && rehydrated.status === "active") {
      rehydrated = finishSimulationAtTime(snapshot, rehydrated, snapshot.deadlineAtMs);
    }
    if (
      (row.status !== "active" && row.status !== "finalized")
      || rehydrated.status !== row.status
      || canonicalJson(rehydrated) !== canonicalJson(storedState)
    ) return null;
    return { snapshot, state: rehydrated };
  } catch {
    return null;
  }
}

function asEvent(row: OutboxRow): OutboxEvent {
  return {
    ...row,
    occurredAt: new Date(row.occurredAt),
    availableAt: new Date(row.availableAt),
    processedAt: row.processedAt === null ? null : new Date(row.processedAt),
    attempts: Number(row.attempts),
  };
}

export class PostgresWorkerRepository implements WorkerRepository {
  private readonly pool: InstanceType<typeof Pool>;

  constructor(pool: InstanceType<typeof Pool>) {
    this.pool = pool;
  }

  async claimBatch(options: ClaimOptions): Promise<OutboxEvent[]> {
    const client = await this.pool.connect();
    const leaseUntil = new Date(options.now.getTime() + options.leaseMs);
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `WITH candidates AS (
           SELECT id
           FROM outbox_events
           WHERE processed_at IS NULL
             AND available_at <= $1
             AND attempts < $4
             AND event_type = ANY($5::text[])
           ORDER BY occurred_at ASC, id ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE outbox_events AS event
         SET available_at = $3,
             attempts = event.attempts + 1
         FROM candidates
         WHERE event.id = candidates.id
         RETURNING event.id,
                   event.aggregate_type AS "aggregateType",
                   event.aggregate_id AS "aggregateId",
                   event.event_type AS "eventType",
                   event.payload,
                   event.occurred_at AS "occurredAt",
                   event.available_at AS "availableAt",
                   event.processed_at AS "processedAt",
                   event.attempts`,
        [options.now, options.batchSize, leaseUntil, options.maxAttempts, options.eventTypes],
      );
      await client.query("COMMIT");
      return result.rows.map(asEvent);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async extendLease(eventId: string, claimedAttempt: number, leaseUntil: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE outbox_events
       SET available_at = $3
       WHERE id = $1 AND attempts = $2 AND processed_at IS NULL`,
      [eventId, claimedAttempt, leaseUntil],
    );
    return result.rowCount === 1;
  }

  async markProcessed(eventId: string, claimedAttempt: number, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE outbox_events
       SET processed_at = $3
       WHERE id = $1 AND attempts = $2 AND processed_at IS NULL`,
      [eventId, claimedAttempt, now],
    );
    return result.rowCount === 1;
  }

  async reschedule(eventId: string, claimedAttempt: number, availableAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE outbox_events
       SET available_at = $3
       WHERE id = $1 AND attempts = $2 AND processed_at IS NULL`,
      [eventId, claimedAttempt, availableAt],
    );
    return result.rowCount === 1;
  }

  async deadLetter(
    eventId: string,
    claimedAttempt: number,
    maxAttempts: number,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE outbox_events
       SET attempts = GREATEST(attempts, $3), available_at = $4
       WHERE id = $1 AND attempts = $2 AND processed_at IS NULL`,
      [eventId, claimedAttempt, maxAttempts, now],
    );
    return result.rowCount === 1;
  }

  async deadLetterCount(
    maxAttempts: number,
    eventTypes: ClaimOptions["eventTypes"],
  ): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM outbox_events
       WHERE processed_at IS NULL AND attempts >= $1 AND event_type = ANY($2::text[])`,
      [maxAttempts, eventTypes],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async scheduleDailyBillingReconciliation(
    input: Parameters<WorkerRepository["scheduleDailyBillingReconciliation"]>[0],
  ): Promise<number> {
    const client = await this.pool.connect();
    const runDate = input.now.toISOString().slice(0, 10);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`billing-reconciliation:${runDate}`]);
      await client.query(
        `INSERT INTO reconciliation_runs(id, provider, status, run_date, snapshot_at, started_at, updated_at)
         VALUES (gen_random_uuid(), 'revenuecat', 'scheduling', $1, $2, $2, $2)
         ON CONFLICT (provider, run_date) DO NOTHING`,
        [runDate, input.now],
      );
      const runResult = await client.query<{
        id: string;
        status: string;
        snapshotAt: Date;
        cursorCreatedAt: Date | null;
        cursorUserId: string | null;
      }>(
        `SELECT id, status, snapshot_at AS "snapshotAt",
                cursor_created_at AS "cursorCreatedAt", cursor_user_id AS "cursorUserId"
         FROM reconciliation_runs WHERE provider = 'revenuecat' AND run_date = $1 FOR UPDATE`,
        [runDate],
      );
      const run = runResult.rows[0];
      if (!run || run.status === "completed" || run.status === "failed" || run.status === "draining") {
        await client.query("COMMIT");
        return 0;
      }
      const candidates = await client.query<{ userId: string; appUserId: string; createdAt: Date }>(
        `SELECT user_id AS "userId", app_user_id AS "appUserId", created_at AS "createdAt"
         FROM billing_customers
         WHERE status = 'active' AND created_at <= $1
           AND ($2::timestamptz IS NULL OR (created_at, user_id) > ($2::timestamptz, $3::uuid))
         ORDER BY created_at, user_id
         LIMIT $4`,
        [run.snapshotAt, run.cursorCreatedAt, run.cursorUserId, input.batchSize],
      );
      for (const candidate of candidates.rows) {
        const itemId = randomUUID();
        const outboxEventId = randomUUID();
        await client.query(
          `INSERT INTO outbox_events(id, aggregate_type, aggregate_id, event_type, payload, occurred_at, available_at)
           VALUES ($1, 'billing_reconciliation', $2, 'billing.reconciliation_requested.v1', $3::jsonb, $4, $4)`,
          [outboxEventId, itemId, JSON.stringify({
            itemId,
            runId: run.id,
            userId: candidate.userId,
            appUserId: candidate.appUserId,
          }), input.now],
        );
        await client.query(
          `INSERT INTO billing_reconciliation_items(
             id, run_id, user_id, app_user_id, outbox_event_id, status, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
          [itemId, run.id, candidate.userId, candidate.appUserId, outboxEventId, input.now],
        );
      }
      const last = candidates.rows.at(-1);
      const draining = candidates.rows.length < input.batchSize;
      await client.query(
        `UPDATE reconciliation_runs SET
           expected_count = expected_count + $2,
           cursor_created_at = COALESCE($3, cursor_created_at),
           cursor_user_id = COALESCE($4, cursor_user_id),
           status = CASE
             WHEN $5 AND checked_count + failed_count = expected_count + $2 THEN 'completed'
             WHEN $5 THEN 'draining'
             ELSE 'scheduling'
           END,
           completed_at = CASE
             WHEN $5 AND checked_count + failed_count = expected_count + $2 THEN $6
             ELSE completed_at
           END,
           updated_at = $6
         WHERE id = $1`,
        [run.id, candidates.rows.length, last?.createdAt ?? null, last?.userId ?? null, draining, input.now],
      );
      await client.query("COMMIT");
      return candidates.rows.length;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileProEntitlement(input: Parameters<WorkerRepository["reconcileProEntitlement"]>[0]): Promise<boolean> {
    const state = input.state;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`billing:${input.userId}:pro`]);
      const current = await client.query<{
        status: string;
        productSku: string;
        store: string;
        environment: string;
        expiresAt: Date | null;
      }>(`SELECT status, product_sku AS "productSku", store, environment, expires_at AS "expiresAt"
          FROM entitlements WHERE user_id = $1 AND key = 'pro'`, [input.userId]);
      const expectedStatus = state.active ? "active" : "inactive";
      const row = current.rows[0];
      const mismatch = !row
        || row.status !== expectedStatus
        || row.productSku !== state.productSku
        || row.store !== state.store
        || row.environment !== state.environment
        || row.expiresAt?.getTime() !== state.expiresAt?.getTime();
      await client.query(
        `INSERT INTO entitlements (
         id, user_id, key, status, product_sku, store,
         starts_at, expires_at, source_event_id, source_occurred_at, provider, environment,
         created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4, $5,
         $6, $7, $8, $9, 'revenuecat', $10, now(), now()
       )
       ON CONFLICT (user_id, key) DO UPDATE SET
         status = EXCLUDED.status,
         product_sku = EXCLUDED.product_sku,
         store = EXCLUDED.store,
         starts_at = EXCLUDED.starts_at,
         expires_at = EXCLUDED.expires_at,
          source_event_id = EXCLUDED.source_event_id,
          source_occurred_at = EXCLUDED.source_occurred_at,
          provider = EXCLUDED.provider,
          environment = EXCLUDED.environment,
          grace_period_expires_at = NULL,
          auto_resume_at = NULL,
          updated_at = now()
       WHERE entitlements.source_occurred_at < EXCLUDED.source_occurred_at
          OR (
            entitlements.source_occurred_at = EXCLUDED.source_occurred_at
            AND entitlements.source_event_id <= EXCLUDED.source_event_id
          )`,
      [
        input.userId,
        state.entitlementKey,
        state.active ? "active" : "inactive",
        state.productSku,
        state.store,
        state.startsAt,
        state.expiresAt,
        input.eventId,
        input.eventOccurredAt,
        state.environment,
      ],
      );
      await client.query("COMMIT");
      return mismatch;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeBillingReconciliationItem(
    input: Parameters<WorkerRepository["completeBillingReconciliationItem"]>[0],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const completed = await client.query(
        `UPDATE billing_reconciliation_items item SET status = 'completed', mismatch = $5,
           completed_at = $6, updated_at = $6
         WHERE item.id = $1 AND item.run_id = $2 AND item.user_id = $3
           AND item.outbox_event_id = $4 AND item.status = 'pending'
         RETURNING item.id`,
        [input.itemId, input.runId, input.userId, input.eventId, input.mismatch, input.completedAt],
      );
      if (completed.rowCount === 1) {
        await client.query(
          `UPDATE reconciliation_runs SET checked_count = checked_count + 1,
             mismatch_count = mismatch_count + $2,
             status = CASE WHEN status = 'draining' AND checked_count + failed_count + 1 = expected_count
               THEN 'completed' ELSE status END,
             completed_at = CASE WHEN status = 'draining' AND checked_count + failed_count + 1 = expected_count
               THEN $3 ELSE completed_at END,
             updated_at = $3
           WHERE id = $1`,
          [input.runId, input.mismatch ? 1 : 0, input.completedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async failBillingReconciliationItem(eventId: string, errorCode: string, failedAt: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const failed = await client.query<{ runId: string }>(
        `UPDATE billing_reconciliation_items SET status = 'failed', error_code = left($2, 120),
           completed_at = $3, updated_at = $3
         WHERE outbox_event_id = $1 AND status = 'pending'
         RETURNING run_id AS "runId"`, [eventId, errorCode, failedAt],
      );
      if (failed.rows[0]) {
        await client.query(
          `UPDATE reconciliation_runs SET failed_count = failed_count + 1,
             status = CASE WHEN status = 'draining' AND checked_count + failed_count + 1 = expected_count
               THEN 'failed' ELSE status END,
             completed_at = CASE WHEN status = 'draining' AND checked_count + failed_count + 1 = expected_count
               THEN $2 ELSE completed_at END,
             updated_at = $2 WHERE id = $1`, [failed.rows[0].runId, failedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async finalizeSimulationDeadline(
    input: Parameters<WorkerRepository["finalizeSimulationDeadline"]>[0],
  ): ReturnType<WorkerRepository["finalizeSimulationDeadline"]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ id: string }>(
        "SELECT id FROM simulation_sessions WHERE id = $1 FOR UPDATE",
        [input.simulationId],
      );
      if (!locked.rows[0]) {
        await client.query("COMMIT");
        return { status: "missing" };
      }

      // Read the database clock only after the row lock is owned. A delayed
      // worker therefore cannot finalize against a timestamp sampled before a
      // concurrent answer/finalization transaction completed.
      const session = await client.query<SimulationSessionRow>(
        `SELECT id,
                blueprint_version_id AS "blueprintVersionId",
                status, rules, snapshot, snapshot_hash AS "snapshotHash",
                state, result, result_hash AS "resultHash",
                started_at AS "startedAt", deadline_at AS "deadlineAt",
                finalized_at AS "finalizedAt", finish_reason AS "finishReason",
                clock_timestamp() AS "observedAt"
         FROM simulation_sessions
         WHERE id = $1`,
        [input.simulationId],
      );
      const row = session.rows[0];
      if (!row || row.deadlineAt.getTime() !== input.expectedDeadlineAt.getTime()) {
        await client.query("COMMIT");
        return { status: "invalid", code: "simulation_deadline_mismatch" };
      }

      const questionRows = await client.query<SimulationQuestionRow>(
        `SELECT position,
                question_version_id AS "questionVersionId",
                subject_id AS "subjectId",
                option_ids AS "optionIds",
                correct_option_id AS "correctOptionId"
         FROM simulation_questions
         WHERE simulation_id = $1
         ORDER BY position`,
        [input.simulationId],
      );
      const answerRows = await client.query<SimulationAnswerRow>(
        `SELECT idempotency_key AS "idempotencyKey",
                question_version_id AS "questionVersionId",
                selected_option_id AS "selectedOptionId",
                received_at AS "receivedAt"
         FROM simulation_answers
         WHERE simulation_id = $1
         ORDER BY received_at, created_at, id`,
        [input.simulationId],
      );
      const rehydrated = rehydrateSimulation(row, questionRows.rows, answerRows.rows);
      if (!rehydrated) {
        await client.query("COMMIT");
        return { status: "invalid", code: "simulation_state_invalid" };
      }

      if (row.status === "finalized") {
        let recomputed: SimulationResult;
        try {
          recomputed = computeSimulationResult(rehydrated.snapshot, rehydrated.state);
        } catch {
          await client.query("COMMIT");
          return { status: "invalid", code: "simulation_result_invalid" };
        }
        if (
          row.result === null
          || row.resultHash !== recomputed.resultHash
          || canonicalJson(row.result) !== canonicalJson(recomputed)
          || row.finishReason !== recomputed.finishReason
          || !sameDate(row.finalizedAt, recomputed.finalizedAtMs)
        ) {
          await client.query("COMMIT");
          return { status: "invalid", code: "simulation_result_invalid" };
        }
        await client.query("COMMIT");
        return { status: "already_finalized", resultHash: recomputed.resultHash };
      }

      if (row.observedAt.getTime() < row.deadlineAt.getTime()) {
        await client.query("COMMIT");
        return { status: "not_due", deadlineAt: new Date(row.deadlineAt) };
      }

      let finalizedState: SimulationState;
      let result: SimulationResult;
      try {
        finalizedState = finishSimulationAtTime(
          rehydrated.snapshot,
          rehydrated.state,
          row.observedAt.getTime(),
        );
        result = computeSimulationResult(rehydrated.snapshot, finalizedState);
      } catch {
        await client.query("COMMIT");
        return { status: "invalid", code: "simulation_result_invalid" };
      }
      if (finalizedState.status !== "finalized" || result.finishReason !== "deadline") {
        await client.query("COMMIT");
        return { status: "invalid", code: "simulation_deadline_finalization_invalid" };
      }

      const updated = await client.query(
        `UPDATE simulation_sessions
         SET status = 'finalized',
             state = $2::jsonb,
             result = $3::jsonb,
             result_hash = $4,
             finalized_at = $5,
             finish_reason = 'deadline',
             updated_at = $6
         WHERE id = $1 AND status = 'active'`,
        [
          input.simulationId,
          JSON.stringify(finalizedState),
          JSON.stringify(result),
          result.resultHash,
          new Date(result.finalizedAtMs),
          row.observedAt,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("simulation_deadline_update_lost");
      await client.query(
        `INSERT INTO audit_logs(
           actor_type, actor_id, action, resource_type, resource_id,
           request_id, before, after
         ) VALUES (
           'worker', 'simulation-deadline', 'simulation.finalized.deadline',
           'simulation', $1, $2,
           '{"status":"active"}'::jsonb,
           jsonb_build_object(
             'status', 'finalized',
             'finishReason', 'deadline',
             'resultHash', $3::text
           )
         )`,
        [input.simulationId, input.eventId, result.resultHash],
      );
      await client.query("COMMIT");
      return { status: "finalized", resultHash: result.resultHash };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getDataRequest(requestId: string): Promise<DataRequestRecord | null> {
    const result = await this.pool.query<{
      id: string;
      userId: string;
      kind: string;
      status: string;
      phase: string;
      requestedAt: Date;
    }>(
      `SELECT id, user_id AS "userId", kind, status, phase, requested_at AS "requestedAt"
       FROM data_requests
       WHERE id = $1
       LIMIT 1`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row || (row.kind !== "export" && row.kind !== "deletion")) return null;
    return { ...row, kind: row.kind, requestedAt: new Date(row.requestedAt) };
  }

  async startDataRequest(input: Parameters<WorkerRepository["startDataRequest"]>[0]): Promise<DataRequestRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string; userId: string | null; kind: string; status: string; phase: string; requestedAt: Date; owns: boolean;
      }>(
        `SELECT id, user_id AS "userId", kind, status, phase, requested_at AS "requestedAt",
                (user_id = $2 OR subject_hash = encode(digest($2::text, 'sha256'), 'hex')) AS owns
         FROM data_requests WHERE id = $1 FOR UPDATE`,
        [input.requestId, input.userId],
      );
      const row = result.rows[0];
      if (!row || !row.owns || row.kind !== input.kind) {
        await client.query("ROLLBACK");
        return null;
      }
      if (row.status === "pending") {
        await client.query(
          `UPDATE data_requests
           SET status = 'processing', processing_started_at = COALESCE(processing_started_at, now()),
               updated_at = now(), state_version = state_version + 1
           WHERE id = $1 AND status = 'pending'`,
          [input.requestId],
        );
      } else if (row.status !== "processing" && row.status !== "completed") {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
         VALUES ($1, 'processing_started', $2, '{}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [input.requestId, `processing:${input.requestId}`],
      );
      await client.query("COMMIT");
      return {
        id: row.id,
        userId: row.userId,
        kind: row.kind as DataRequestRecord["kind"],
        status: row.status === "pending" ? "processing" : row.status,
        phase: row.phase,
        requestedAt: new Date(row.requestedAt),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async buildUserExportSnapshot(input: Parameters<WorkerRepository["buildUserExportSnapshot"]>[0]): Promise<DataExportSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const request = await client.query<{ requestedAt: Date; clerkSubject: string }>(
        `SELECT request.requested_at AS "requestedAt", identity.subject AS "clerkSubject"
         FROM data_requests request
         JOIN auth_identities identity ON identity.user_id = request.user_id AND identity.provider = 'clerk'
         WHERE request.id = $1 AND request.user_id = $2 AND request.kind = 'export'
           AND request.status = 'processing'
         LIMIT 1`,
        [input.requestId, input.userId],
      );
      const owner = request.rows[0];
      if (!owner) throw new Error("privacy_export_owner_missing");

      const datasets: Record<string, readonly Record<string, unknown>[]> = {};
      const read = async (name: string, query: string, parameters: unknown[]): Promise<void> => {
        const result = await client.query<{ rows: Record<string, unknown>[] }>(query, parameters);
        datasets[name] = result.rows[0]?.rows ?? [];
      };

      await read("profile", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.id), '[]'::jsonb) AS rows FROM (
        SELECT id, clerk_user_id, email, display_name, avatar_url, concurso_id, daily_goal_minutes,
               xp_total, current_rank, current_streak, max_streak, is_premium, premium_expires_at,
               created_at, updated_at, last_activity_at, deletion_requested_at
        FROM users WHERE id = $1
      ) row`, [input.userId]);
      const userIdTables: [string, string, string, string?][] = [
        ["authIdentities", "auth_identities", "id"],
        ["ageProfile", "age_profiles", "user_id"],
        ["identityOperations", "identity_operations", "created_at, idempotency_key"],
        ["devices", "devices", "created_at, id"],
        ["productSelection", "user_product_selections", "selected_at"],
        ["learningSessions", "learning_sessions", "started_at, id"],
        ["itemExposures", "item_exposures", "exposed_at, id"],
        ["attempts", "attempts", "answered_at, id"],
        ["topicMastery", "topic_mastery", "topic_id"],
        ["reviewSchedules", "review_schedules", "topic_id"],
        ["billingCustomers", "billing_customers", "created_at, user_id"],
        ["billingCustomerAliases", "billing_customer_aliases", "created_at, alias", "alias, kind, created_at"],
        ["entitlements", "entitlements", "created_at, id"],
        ["socialProfile", "social_profiles", "user_id"],
      ];
      for (const [name, table, order] of userIdTables) {
        await read(name, `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY ${order}), '[]'::jsonb) AS rows
          FROM (SELECT * FROM ${table} WHERE user_id = $1) row`, [input.userId]);
      }
      // Integrity exports are intentionally projected instead of SELECT *:
      // the user receives understandable state and decisions, never nonces,
      // proof/token digests, key identifiers, public keys, counters, receipts,
      // envelope hashes or encrypted provider material useful for replay.
      await read("platformAgeSignals", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY last_observed_at, platform), '[]'::jsonb) AS rows
        FROM (SELECT platform, source, sharing_status, age_band, trust_status,
                     assurance_kind, verified_at, expires_at, verified_build,
                     verification_policy_version, pending_conflict,
                     first_observed_at, last_observed_at
              FROM platform_age_signals WHERE user_id = $1) row`, [input.userId]);
      await read("integrityDeviceBindings", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, platform, environment, status, first_seen_at, last_seen_at,
                     revoked_at, created_at, updated_at
              FROM integrity_device_bindings WHERE user_id = $1) row`, [input.userId]);
      await read("appIntegrityKeys", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, device_binding_id, platform, environment, format_policy, bundle_id,
                     bundle_version, aaguid_environment, validation_category,
                     status, attested_at, last_asserted_at, revoked_at, created_at, updated_at
              FROM app_integrity_keys WHERE user_id = $1) row`, [input.userId]);
      await read("integrityChallenges", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY issued_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, device_binding_id, purpose, platform, environment,
                     canonicalization_version, status, issued_at, expires_at,
                     reserved_at, consumed_at, terminal_at, failure_code, attempt_count
              FROM integrity_challenges WHERE user_id = $1) row`, [input.userId]);
      await read("integrityVerifications", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, device_binding_id, provider, purpose, platform, environment, status,
                     outcome_code, app_build_decision, device_decision, testing_response,
                     policy_version, issued_at, verified_at, terminal_at, created_at, updated_at
              FROM integrity_verifications WHERE user_id = $1) row`, [input.userId]);
      // Export the learner's simulation activity, but do not copy the immutable
      // grading snapshot, answer key, source text, internal hashes or
      // idempotency keys into the DSR object. The result projection contains
      // only the learner's own aggregate outcome and subject breakdown.
      await read("simulationSessions", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.started_at, row.id), '[]'::jsonb) AS rows
        FROM (
          SELECT id, product_id, exam_version_id, blueprint_version_id, status,
                 started_at, deadline_at, finalized_at, finish_reason,
                 result ->> 'score' AS score,
                 result ->> 'maxScore' AS max_score,
                 (result ->> 'correctCount')::integer AS correct_count,
                 (result ->> 'incorrectCount')::integer AS incorrect_count,
                 (result ->> 'unansweredCount')::integer AS unanswered_count,
                 result -> 'subjects' AS subject_results,
                 created_at, updated_at
          FROM simulation_sessions WHERE user_id = $1
        ) row`, [input.userId]);
      await read("simulationAnswers", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.received_at, row.id), '[]'::jsonb) AS rows
        FROM (
          SELECT answer.id, answer.simulation_id, answer.question_version_id,
                 answer.selected_option_id, answer.received_at, answer.created_at
          FROM simulation_answers answer
          INNER JOIN simulation_sessions session ON session.id = answer.simulation_id
          WHERE session.user_id = $1
        ) row`, [input.userId]);
      await read("consents", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY recorded_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, kind, document_version, granted, actor_role, recorded_at
              FROM consents WHERE user_id = $1) row`, [input.userId]);
      await read("reports", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, target_type, CASE WHEN target_type = 'user' THEN NULL ELSE target_id END AS target_id,
                     reason, details, status, created_at, resolved_at
              FROM reports WHERE reporter_user_id = $1) row`, [input.userId]);
      await read("guardianLinks", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, CASE WHEN minor_user_id = $1 THEN 'minor' ELSE 'guardian' END AS own_role,
                     status, verified_at, revoked_at, created_at, updated_at
              FROM guardian_links WHERE minor_user_id = $1 OR guardian_user_id = $1) row`, [input.userId]);
      await read("guardianInvitations", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, CASE WHEN minor_user_id = $1 THEN 'minor' ELSE 'guardian' END AS own_role,
                     CASE
                       WHEN revoked_at IS NOT NULL THEN 'revoked'
                       WHEN used_at IS NOT NULL THEN 'accepted'
                       WHEN expires_at <= now() THEN 'expired'
                       ELSE 'pending'
                     END AS status,
                     expires_at, used_at AS accepted_at, revoked_at, created_at, updated_at
               FROM guardian_invitations WHERE minor_user_id = $1 OR accepted_by_user_id = $1) row`, [input.userId]);
      await read("dataRequests", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY requested_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, kind, status, phase, requested_at, processing_started_at, updated_at, completed_at,
                     export_checksum_sha256, export_size_bytes, export_expires_at, error_code
              FROM data_requests WHERE user_id = $1) row`, [input.userId]);
      await read("friendships", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, own_role), '[]'::jsonb) AS rows
        FROM (SELECT CASE WHEN requester_id = $1 THEN 'requester' ELSE 'addressee' END AS own_role,
                     status, created_at, updated_at
              FROM friendships WHERE requester_id = $1 OR addressee_id = $1) row`, [input.userId]);
      await read("blocks", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, own_role), '[]'::jsonb) AS rows
        FROM (SELECT CASE WHEN blocker_id = $1 THEN 'blocker' ELSE 'blocked' END AS own_role, created_at
              FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1) row`, [input.userId]);
      await read("duels", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, product_id, CASE WHEN player_one_id = $1 THEN 'player_one' ELSE 'player_two' END AS own_role,
                     status, started_at, completed_at, created_at, updated_at
              FROM duel_matches_v1 WHERE player_one_id = $1 OR player_two_id = $1) row`, [input.userId]);
      await read("riskEvents", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY occurred_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, type, severity, score, occurred_at FROM risk_events WHERE user_id = $1) row`, [input.userId]);
      await read("subscriptionEvents", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY occurred_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, user_id, provider_event_id, type, occurred_at, received_at FROM subscription_events WHERE user_id = $1) row`, [input.userId]);

      const legacyTables: [string, string, string][] = [
        ["legacyAnswers", "user_answers", "created_at, id"],
        ["legacySimulations", "simulados", "created_at, id"],
        ["legacyAchievements", "user_achievements", "unlocked_at, id"],
        ["legacyStats", "user_stats", "clerk_user_id"],
        ["legacyStudyLogs", "study_logs", "created_at, id"],
      ];
      for (const [name, table, order] of legacyTables) {
        await read(name, `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY ${order}), '[]'::jsonb) AS rows
          FROM (SELECT * FROM ${table} WHERE clerk_user_id = $1) row`, [owner.clerkSubject]);
      }
      await read("legacyDuels", `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY created_at, id), '[]'::jsonb) AS rows
        FROM (SELECT id, CASE WHEN player1_id = $1 THEN 'player1' ELSE 'player2' END AS own_role,
                     mode, total_questions,
                     CASE WHEN player1_id = $1 THEN player1_score ELSE player2_score END AS own_score,
                     (winner_id = $1) AS own_won, started_at, completed_at, created_at
              FROM duels WHERE player1_id = $1 OR player2_id = $1) row`, [owner.clerkSubject]);

      await client.query("COMMIT");
      return {
        schemaVersion: 1,
        subjectId: input.userId,
        requestedAt: new Date(owner.requestedAt).toISOString(),
        datasets,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDataRequestStep(input: Parameters<WorkerRepository["recordDataRequestStep"]>[0]): Promise<void> {
    const allowedPrevious: Record<string, string[]> = {
      export_snapshot: ["requested", "export_snapshot"],
      export_stored: ["requested", "export_snapshot", "export_stored"],
      access_revoked: ["requested", "access_revoked"],
      external_accounts_erased: ["access_revoked", "external_accounts_erased"],
    };
    const previous = allowedPrevious[input.phase];
    if (!previous) throw new Error("privacy_phase_invalid");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ userId: string | null; status: string; phase: string }>(
        `SELECT user_id AS "userId", status, phase FROM data_requests WHERE id = $1 FOR UPDATE`,
        [input.requestId],
      );
      const row = request.rows[0];
      if (!row || row.status !== "processing" || row.userId !== input.userId || !previous.includes(row.phase)) {
        throw new Error("privacy_state_transition_rejected");
      }
      const serializedEvidence = JSON.stringify(input.evidence);
      const existing = await client.query<{ matches: boolean }>(
        `SELECT evidence = $3::jsonb AS matches
         FROM data_request_evidence WHERE request_id = $1 AND step = $2`,
        [input.requestId, input.step, serializedEvidence],
      );
      if (existing.rows[0] && !existing.rows[0].matches) {
        throw new Error("privacy_evidence_conflict");
      }
      const inserted = await client.query(
        `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (request_id, step) DO NOTHING
         RETURNING id`,
        [input.requestId, input.step, input.idempotencyKey, serializedEvidence],
      );
      if (!existing.rows[0] && inserted.rowCount !== 1) throw new Error("privacy_evidence_not_persisted");
      await client.query(
        `UPDATE data_requests SET phase = $2, updated_at = now(), state_version = state_version + 1,
           evidence = evidence || $3::jsonb,
           export_checksum_sha256 = COALESCE($4, export_checksum_sha256),
           export_size_bytes = COALESCE($5, export_size_bytes),
           export_object_key = COALESCE($6, export_object_key),
           export_object_generation = COALESCE($7, export_object_generation),
           export_expires_at = COALESCE($8, export_expires_at),
           retention_policy_id = COALESCE($9, retention_policy_id),
           retention_policy_sha256 = COALESCE($10, retention_policy_sha256)
         WHERE id = $1`,
        [
          input.requestId, input.phase, JSON.stringify({ [input.step]: true }),
          input.exportMetadata?.checksumSha256 ?? null,
          input.exportMetadata?.sizeBytes ?? null,
          input.exportMetadata?.objectKey ?? null,
          input.exportMetadata?.generation ?? null,
          input.exportMetadata?.expiresAt ?? null,
          input.retentionPolicy?.id ?? null,
          input.retentionPolicy?.sha256 ?? null,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async listUserExportObjects(input: Parameters<WorkerRepository["listUserExportObjects"]>[0]): Promise<readonly import("./types.ts").PrivacyExportObject[]> {
    const result = await this.pool.query<{
      requestId: string;
      objectKey: string;
      generation: string;
      checksumSha256: string;
    }>(
      `SELECT id AS "requestId", export_object_key AS "objectKey",
              export_object_generation AS generation,
              export_checksum_sha256 AS "checksumSha256"
       FROM data_requests
       WHERE user_id = $1 AND kind = 'export' AND status = 'completed'
         AND export_revoked_at IS NULL
         AND export_object_key IS NOT NULL AND export_object_generation IS NOT NULL
         AND export_checksum_sha256 IS NOT NULL
       ORDER BY requested_at, id`,
      [input.userId],
    );
    return result.rows;
  }

  async recordExportObjectsRevoked(input: Parameters<WorkerRepository["recordExportObjectsRevoked"]>[0]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deletion = await client.query<{ status: string; phase: string }>(
        `SELECT status, phase FROM data_requests
         WHERE id = $1 AND user_id = $2 AND kind = 'deletion' FOR UPDATE`,
        [input.deletionRequestId, input.userId],
      );
      const row = deletion.rows[0];
      if (!row || row.status !== "processing"
          || !["requested", "access_revoked", "external_accounts_erased", "internal_data_erased"].includes(row.phase)) {
        throw new Error("privacy_export_revocation_state_rejected");
      }
      const alreadyRecorded = await client.query(
        `SELECT 1 FROM data_request_evidence WHERE request_id = $1 AND step = 'export_objects_revoked'`,
        [input.deletionRequestId],
      );
      if (alreadyRecorded.rowCount === 1) {
        await client.query("COMMIT");
        return;
      }
      const current = await client.query<{
        requestId: string; objectKey: string; generation: string; checksumSha256: string; subjectHash: string;
      }>(
        `SELECT id AS "requestId", export_object_key AS "objectKey",
                export_object_generation AS generation,
                export_checksum_sha256 AS "checksumSha256", subject_hash AS "subjectHash"
         FROM data_requests
         WHERE user_id = $1 AND kind = 'export' AND status = 'completed'
           AND export_revoked_at IS NULL
           AND export_object_key IS NOT NULL AND export_object_generation IS NOT NULL
           AND export_checksum_sha256 IS NOT NULL
         ORDER BY requested_at, id FOR UPDATE`,
        [input.userId],
      );
      const expected = current.rows.map(({ subjectHash: _subjectHash, ...object }) => object);
      if (JSON.stringify(expected) !== JSON.stringify(input.objects)) {
        throw new Error("privacy_export_revocation_set_changed");
      }
      for (const object of current.rows) {
        const expectedKey = `dsr/exports/${object.requestId}/${object.checksumSha256}.json`;
        if (object.objectKey !== expectedKey || !/^\d+$/.test(object.generation)) {
          throw new Error("privacy_export_revocation_descriptor_rejected");
        }
        await client.query(
          `UPDATE data_requests SET export_revoked_at = COALESCE(export_revoked_at, now()), updated_at = now()
           WHERE id = $1 AND user_id = $2 AND export_revoked_at IS NULL`,
          [object.requestId, input.userId],
        );
        await client.query(
          `INSERT INTO data_request_export_access_events(
             request_id, subject_hash, event_type, object_generation, request_correlation_id
           ) VALUES ($1, $2, 'revoked', $3, $4) ON CONFLICT DO NOTHING`,
          [object.requestId, object.subjectHash, object.generation, `deletion:${input.deletionRequestId}`],
        );
      }
      await client.query(
        `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
         VALUES ($1, 'export_objects_revoked', $2, $3::jsonb)`,
        [
          input.deletionRequestId,
          `export-objects-revoked:${input.deletionRequestId}`,
          JSON.stringify({ objectCount: current.rows.length }),
        ],
      );
      await client.query(
        `UPDATE data_requests SET evidence = evidence || '{"export_objects_revoked":true}'::jsonb,
           updated_at = now(), state_version = state_version + 1 WHERE id = $1`,
        [input.deletionRequestId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async revokeUserAccess(input: Parameters<WorkerRepository["revokeUserAccess"]>[0]): Promise<import("./types.ts").PrivacySubjects> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ phase: string; status: string }>(
        `SELECT phase, status FROM data_requests WHERE id = $1 AND user_id = $2 AND kind = 'deletion' FOR UPDATE`,
        [input.requestId, input.userId],
      );
      if (!request.rows[0] || request.rows[0].status !== "processing"
          || !["requested", "access_revoked", "external_accounts_erased"].includes(request.rows[0].phase)) {
        throw new Error("privacy_access_revocation_rejected");
      }
      const identity = await client.query<{ subject: string }>(
        `SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = 'clerk' LIMIT 1`,
        [input.userId],
      );
      const clerkSubject = identity.rows[0]?.subject;
      if (!clerkSubject) throw new Error("privacy_clerk_subject_missing");
      const billing = await client.query<{ appUserId: string }>(
        `SELECT app_user_id AS "appUserId" FROM billing_customers WHERE user_id = $1 FOR UPDATE`,
        [input.userId],
      );
      const revenueCatCustomerId = billing.rows[0]?.appUserId;
      if (!revenueCatCustomerId) throw new Error("privacy_revenuecat_customer_missing");
      await client.query(`UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, now()), is_premium = false,
        premium_expires_at = NULL, updated_at = now() WHERE id = $1`, [input.userId]);
      await client.query(`UPDATE devices SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE user_id = $1`, [input.userId]);
      await client.query(`UPDATE age_profiles SET social_enabled = false, notifications_enabled = false, updated_at = now() WHERE user_id = $1`, [input.userId]);
      await client.query(`UPDATE social_profiles SET discoverable = false, updated_at = now() WHERE user_id = $1`, [input.userId]);
      await client.query(`UPDATE integrity_verifications
        SET status = 'indeterminate', outcome_code = 'account_deletion_requested',
            terminal_at = now(), verified_at = NULL, updated_at = now()
        WHERE user_id = $1 AND status = 'verifying'`, [input.userId]);
      await client.query(`UPDATE integrity_challenges
        SET status = CASE WHEN status = 'issued' THEN 'expired' ELSE 'indeterminate' END,
            failure_code = 'account_deletion_requested', terminal_at = now(),
            lease_owner = NULL, lease_expires_at = NULL,
            proof_ciphertext = NULL, proof_key_version = NULL, proof_delete_at = NULL
        WHERE user_id = $1 AND status IN ('issued','verifying')`, [input.userId]);
      await client.query(`UPDATE app_integrity_keys
        SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE user_id = $1 AND status IN ('pending','active')`, [input.userId]);
      await client.query(`UPDATE integrity_device_bindings
        SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE user_id = $1 AND status = 'active'`, [input.userId]);
      await client.query(`UPDATE entitlements SET status = 'revoked', expires_at = LEAST(COALESCE(expires_at, now()), now()), updated_at = now() WHERE user_id = $1`, [input.userId]);
      await client.query(`UPDATE billing_customers SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE user_id = $1`, [input.userId]);
      await client.query(`DELETE FROM friendships WHERE requester_id = $1 OR addressee_id = $1`, [input.userId]);
      await client.query(`DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1`, [input.userId]);
      await client.query(
        `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
         VALUES ($1, 'access_revoked', $2, '{"devices":true,"integrity":true,"entitlement":true,"social":true}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [input.requestId, `access-revoked:${input.requestId}`],
      );
      if (request.rows[0].phase !== "external_accounts_erased") {
        await client.query(`UPDATE data_requests SET phase = 'access_revoked', updated_at = now(),
          state_version = state_version + 1, evidence = evidence || '{"access_revoked":true}'::jsonb WHERE id = $1`, [input.requestId]);
      }
      await client.query("COMMIT");
      return { clerkSubject, revenueCatCustomerId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async eraseUserData(input: Parameters<WorkerRepository["eraseUserData"]>[0]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ phase: string; status: string; subjectHash: string }>(
        `SELECT phase, status, subject_hash AS "subjectHash" FROM data_requests
         WHERE id = $1 AND (user_id = $2 OR subject_hash = encode(digest($2::text, 'sha256'), 'hex')) FOR UPDATE`,
        [input.requestId, input.userId],
      );
      const row = request.rows[0];
      if (!row || row.status !== "processing" || !["external_accounts_erased", "internal_data_erased"].includes(row.phase)) {
        throw new Error("privacy_internal_erasure_rejected");
      }
      if (row.phase !== "internal_data_erased") {
        const identity = await client.query<{ subject: string }>(
          `SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = 'clerk' LIMIT 1`,
          [input.userId],
        );
        const clerkSubject = identity.rows[0]?.subject;
        if (!clerkSubject) throw new Error("privacy_clerk_subject_missing_before_erasure");
        await client.query(`UPDATE subscription_events SET user_id = NULL,
          payload = jsonb_build_object('retained_for_policy', $2::text) WHERE user_id = $1`, [input.userId, input.retentionPolicy.id]);
        await client.query(`UPDATE risk_events SET user_id = NULL,
          evidence = jsonb_build_object('retained_for_policy', $2::text, 'subject_hash', $3::text) WHERE user_id = $1`,
          [input.userId, input.retentionPolicy.id, row.subjectHash]);
        await client.query(`UPDATE audit_logs SET actor_id = $2,
          before = NULL, after = NULL WHERE actor_id = $1::text`, [input.userId, row.subjectHash]);
        await client.query(`UPDATE audit_logs SET resource_id = $2, before = NULL, after = NULL
          WHERE resource_type = 'user' AND resource_id = $1::text`, [input.userId, row.subjectHash]);
        await client.query(`UPDATE guardian_links SET guardian_email_hash = $2
          WHERE guardian_user_id = $1`, [input.userId, row.subjectHash]);
        await client.query(`UPDATE reports SET target_id = $2
          WHERE target_type = 'user' AND target_id = $1::text`, [input.userId, row.subjectHash]);
        await client.query(`UPDATE webhook_inbox SET payload = jsonb_build_object(
            'retained_for_policy', $2::text, 'provider', provider, 'event_id', event_id)
          WHERE provider = 'revenuecat' AND (
            payload #>> '{event,app_user_id}' IN (SELECT alias FROM billing_customer_aliases WHERE user_id = $1)
            OR payload #>> '{event,original_app_user_id}' IN (SELECT alias FROM billing_customer_aliases WHERE user_id = $1)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(CASE
                WHEN jsonb_typeof(payload #> '{event,aliases}') = 'array' THEN payload #> '{event,aliases}'
                ELSE '[]'::jsonb END) candidate(alias)
              WHERE candidate.alias IN (SELECT alias FROM billing_customer_aliases WHERE user_id = $1)
            )
          )`, [input.userId, input.retentionPolicy.id]);
        await client.query(`DELETE FROM duel_matches_v1 WHERE player_one_id = $1 OR player_two_id = $1`, [input.userId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [input.userId]);
        await client.query(
          `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
           VALUES ($1, 'internal_data_erased', $2, $3::jsonb) ON CONFLICT DO NOTHING`,
          [input.requestId, `internal-erased:${input.requestId}`, JSON.stringify({ retentionPolicyId: input.retentionPolicy.id })],
        );
        await client.query(`UPDATE data_requests SET phase = 'internal_data_erased', updated_at = now(),
          state_version = state_version + 1, retention_policy_id = $2, retention_policy_sha256 = $3,
          evidence = evidence || '{"internal_data_erased":true}'::jsonb WHERE id = $1`,
          [input.requestId, input.retentionPolicy.id, input.retentionPolicy.sha256]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async completeDataRequest(input: Parameters<WorkerRepository["completeDataRequest"]>[0]): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const phase = input.kind === "export" ? "export_stored" : "internal_data_erased";
      await client.query(
        `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
         SELECT id, 'completed', $4, '{}'::jsonb FROM data_requests
         WHERE id = $1 AND kind = $3 AND phase = $5
           AND (user_id = $2 OR subject_hash = encode(digest($2::text, 'sha256'), 'hex'))
         ON CONFLICT DO NOTHING`,
        [input.requestId, input.userId, input.kind, `completed:${input.requestId}`, phase],
      );
      const result = await client.query<{ status: string }>(
        `UPDATE data_requests
         SET status = 'completed', phase = 'completed', completed_at = COALESCE(completed_at, $4),
             updated_at = $4, state_version = state_version + 1, failure_reason = NULL, error_code = NULL,
             evidence = evidence || '{"completed":true}'::jsonb
         WHERE id = $1 AND kind = $3 AND status = 'processing' AND phase = $5
           AND (user_id = $2 OR subject_hash = encode(digest($2::text, 'sha256'), 'hex'))
         RETURNING status`,
        [input.requestId, input.userId, input.kind, input.completedAt, phase],
      );
      await client.query("COMMIT");
      return result.rows[0]?.status === "completed";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}

export function createPostgresPool(databaseUrl: string): InstanceType<typeof Pool> {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "ia-aprova-worker",
  });
}
