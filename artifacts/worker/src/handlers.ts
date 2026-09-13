import { PRO_ENTITLEMENT_KEY, PRO_PRODUCT_SKUS } from "./config.ts";
import { DeferredWorkerError, InvalidEventError, RetryableWorkerError } from "./errors.ts";
import type {
  EventHandler,
  HandlerRegistry,
  OutboxEvent,
  PrivacyAdapter,
  RevenueCatLookup,
  SupportedEventType,
  WorkerRepository,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SIMULATION_DURATION_MS = 10_080 * 60_000;

function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InvalidEventError(code);
  return value;
}

function assertEnvelope(event: OutboxEvent, aggregateType: string): void {
  if (
    event.aggregateType !== aggregateType
    || event.processedAt !== null
    || !event.payload
    || typeof event.payload !== "object"
    || Array.isArray(event.payload)
    || Number.isNaN(event.occurredAt.getTime())
  ) {
    throw new InvalidEventError("event_envelope_invalid");
  }
}

function exactPayloadKeys(payload: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(payload).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalDate(value: unknown, code: string): Date {
  if (typeof value !== "string") throw new InvalidEventError(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new InvalidEventError(code);
  }
  return parsed;
}

export interface HandlerDependencies {
  repository: WorkerRepository;
  revenueCat: RevenueCatLookup | null;
  privacyAdapter: PrivacyAdapter | null;
  now?: () => Date;
}

function billingRestoreHandler(dependencies: HandlerDependencies): EventHandler {
  return async (event, context) => {
    assertEnvelope(event, "billing_restore");
    if (!exactPayloadKeys(event.payload, ["appUserId", "provider", "userId"])) {
      throw new InvalidEventError("billing_restore_payload_invalid");
    }
    const userId = uuid(event.payload["userId"], "billing_user_id_invalid");
    const appUserId = uuid(event.payload["appUserId"], "billing_app_user_id_invalid");
    if (event.aggregateId !== userId || event.payload["provider"] !== "revenuecat") {
      throw new InvalidEventError("billing_restore_payload_invalid");
    }
    if (!dependencies.revenueCat) {
      throw new RetryableWorkerError("revenuecat_not_configured");
    }

    const active = await dependencies.revenueCat.lookupPro(appUserId, context.signal);
    if (
      active
      && (
        active.active !== true
        || active.entitlementKey !== PRO_ENTITLEMENT_KEY
        || (active.store !== "APP_STORE" && active.store !== "PLAY_STORE")
        || active.productSku !== PRO_PRODUCT_SKUS[active.store]
        || (active.environment !== "production" && active.environment !== "sandbox")
        || Number.isNaN(active.startsAt.getTime())
        || active.expiresAt === null
        || Number.isNaN(active.expiresAt.getTime())
      )
    ) {
      throw new RetryableWorkerError("revenuecat_state_invalid");
    }

    await dependencies.repository.reconcileProEntitlement({
      userId,
      eventId: event.id,
      eventOccurredAt: event.occurredAt,
      state: active ?? {
        active: false,
        entitlementKey: PRO_ENTITLEMENT_KEY,
        productSku: PRO_PRODUCT_SKUS.APP_STORE,
        store: "REVENUECAT",
        environment: dependencies.revenueCat.environment,
        startsAt: event.occurredAt,
        expiresAt: null,
      },
    });
  };
}

function billingReconciliationHandler(dependencies: HandlerDependencies): EventHandler {
  return async (event, context) => {
    assertEnvelope(event, "billing_reconciliation");
    if (!exactPayloadKeys(event.payload, ["appUserId", "itemId", "runId", "userId"])) {
      throw new InvalidEventError("billing_reconciliation_payload_invalid");
    }
    const userId = uuid(event.payload["userId"], "billing_user_id_invalid");
    const appUserId = uuid(event.payload["appUserId"], "billing_app_user_id_invalid");
    const itemId = uuid(event.payload["itemId"], "billing_item_id_invalid");
    const runId = uuid(event.payload["runId"], "billing_run_id_invalid");
    if (event.aggregateId !== itemId) throw new InvalidEventError("billing_reconciliation_payload_invalid");
    if (!dependencies.revenueCat) throw new RetryableWorkerError("revenuecat_not_configured");

    const active = await dependencies.revenueCat.lookupPro(appUserId, context.signal);
    if (active && (
      active.active !== true
      || active.entitlementKey !== PRO_ENTITLEMENT_KEY
      || (active.store !== "APP_STORE" && active.store !== "PLAY_STORE")
      || active.productSku !== PRO_PRODUCT_SKUS[active.store]
      || active.expiresAt === null
      || Number.isNaN(active.startsAt.getTime())
      || Number.isNaN(active.expiresAt.getTime())
    )) throw new RetryableWorkerError("revenuecat_state_invalid");

    const mismatch = await dependencies.repository.reconcileProEntitlement({
      userId,
      eventId: event.id,
      eventOccurredAt: event.occurredAt,
      state: active ?? {
        active: false,
        entitlementKey: PRO_ENTITLEMENT_KEY,
        productSku: PRO_PRODUCT_SKUS.APP_STORE,
        store: "REVENUECAT",
        environment: dependencies.revenueCat.environment,
        startsAt: event.occurredAt,
        expiresAt: null,
      },
    });
    await dependencies.repository.completeBillingReconciliationItem({
      itemId,
      runId,
      userId,
      eventId: event.id,
      mismatch,
      completedAt: (dependencies.now ?? (() => new Date()))(),
    });
  };
}

function privacyHandler(
  dependencies: HandlerDependencies,
  kind: "export" | "deletion",
): EventHandler {
  return async (event, context) => {
    assertEnvelope(event, "data_request");
    const requestId = uuid(event.payload["dataRequestId"], "privacy_request_id_invalid");
    const userId = uuid(event.payload["userId"], "privacy_user_id_invalid");
    if (event.aggregateId !== requestId) {
      throw new InvalidEventError("privacy_request_payload_invalid");
    }

    const request = await dependencies.repository.getDataRequest(requestId);
    if (!request || (request.userId !== null && request.userId !== userId) || request.kind !== kind) {
      throw new InvalidEventError("privacy_request_mismatch");
    }
    if (request.status === "completed") return;
    if (request.status !== "pending" && request.status !== "processing") {
      throw new InvalidEventError("privacy_request_status_invalid");
    }
    if (!dependencies.privacyAdapter) {
      throw new RetryableWorkerError(`privacy_${kind}_adapter_unavailable`);
    }

    const input = { requestId, userId, signal: context.signal };
    if (kind === "export") await dependencies.privacyAdapter.exportUserData(input);
    else await dependencies.privacyAdapter.deleteUserData(input);

    const completed = await dependencies.repository.completeDataRequest({
      requestId,
      userId,
      kind,
      completedAt: (dependencies.now ?? (() => new Date()))(),
    });
    if (!completed) {
      const latest = await dependencies.repository.getDataRequest(requestId);
      if (latest?.status !== "completed") {
        throw new RetryableWorkerError("privacy_completion_not_persisted");
      }
    }
  };
}

function simulationDeadlineHandler(dependencies: HandlerDependencies): EventHandler {
  return async (event) => {
    assertEnvelope(event, "simulation");
    if (!exactPayloadKeys(event.payload, ["deadlineAt", "simulationId"])) {
      throw new InvalidEventError("simulation_deadline_payload_invalid");
    }
    const eventId = uuid(event.id, "simulation_event_id_invalid");
    const simulationId = uuid(event.payload["simulationId"], "simulation_id_invalid");
    const deadlineAt = canonicalDate(event.payload["deadlineAt"], "simulation_deadline_invalid");
    const durationFromEventMs = deadlineAt.getTime() - event.occurredAt.getTime();
    if (
      event.aggregateId !== simulationId
      || durationFromEventMs <= 0
      || durationFromEventMs > MAX_SIMULATION_DURATION_MS
    ) {
      throw new InvalidEventError("simulation_deadline_payload_invalid");
    }

    const outcome = await dependencies.repository.finalizeSimulationDeadline({
      simulationId,
      expectedDeadlineAt: deadlineAt,
      eventId,
    });
    if (outcome.status === "missing") return;
    if (outcome.status === "invalid") throw new InvalidEventError(outcome.code);
    if (outcome.status === "not_due") {
      if (outcome.deadlineAt.getTime() !== deadlineAt.getTime()) {
        throw new InvalidEventError("simulation_deadline_mismatch");
      }
      throw new DeferredWorkerError("simulation_deadline_not_due", deadlineAt);
    }
    if (!SHA256.test(outcome.resultHash)) {
      throw new InvalidEventError("simulation_result_hash_invalid");
    }
  };
}

export function createHandlerRegistry(dependencies: HandlerDependencies): HandlerRegistry {
  return new Map<SupportedEventType, EventHandler>([
    ["billing.restore_requested.v1", billingRestoreHandler(dependencies)],
    ["billing.reconciliation_requested.v1", billingReconciliationHandler(dependencies)],
    ["privacy.export_requested.v1", privacyHandler(dependencies, "export")],
    ["privacy.deletion_requested.v1", privacyHandler(dependencies, "deletion")],
    ["simulation.deadline_reached.v1", simulationDeadlineHandler(dependencies)],
  ]);
}
