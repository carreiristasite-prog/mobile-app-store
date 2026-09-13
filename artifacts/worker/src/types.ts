export type SupportedEventType =
  | "billing.restore_requested.v1"
  | "billing.reconciliation_requested.v1"
  | "privacy.export_requested.v1"
  | "privacy.deletion_requested.v1"
  | "simulation.deadline_reached.v1";

export interface OutboxEvent {
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

export interface ClaimOptions {
  now: Date;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  eventTypes: readonly SupportedEventType[];
}

export interface ProEntitlementState {
  active: boolean;
  entitlementKey: "pro";
  productSku: "iaaprova.pro.monthly" | "iaaprova.pro.monthly:monthly-auto-renewing";
  store: "APP_STORE" | "PLAY_STORE" | "REVENUECAT";
  environment: "production" | "sandbox";
  startsAt: Date;
  expiresAt: Date | null;
}

export interface DataRequestRecord {
  id: string;
  userId: string | null;
  kind: "export" | "deletion";
  status: string;
  phase: string;
  requestedAt: Date;
}

export type SimulationDeadlineOutcome =
  | { status: "finalized"; resultHash: string }
  | { status: "already_finalized"; resultHash: string }
  | { status: "missing" }
  | { status: "not_due"; deadlineAt: Date }
  | { status: "invalid"; code: string };

export interface PrivacySubjects {
  clerkSubject: string;
  revenueCatCustomerId: string;
}

export interface DataExportSnapshot {
  schemaVersion: 1;
  subjectId: string;
  requestedAt: string;
  datasets: Record<string, readonly Record<string, unknown>[]>;
}

export type DataRequestStep =
  | "processing_started"
  | "export_snapshot"
  | "export_stored"
  | "export_objects_revoked"
  | "access_revoked"
  | "external_accounts_erased"
  | "internal_data_erased"
  | "completed";

export interface WorkerRepository {
  claimBatch(options: ClaimOptions): Promise<OutboxEvent[]>;
  extendLease(
    eventId: string,
    claimedAttempt: number,
    leaseUntil: Date,
  ): Promise<boolean>;
  markProcessed(eventId: string, claimedAttempt: number, now: Date): Promise<boolean>;
  reschedule(eventId: string, claimedAttempt: number, availableAt: Date): Promise<boolean>;
  deadLetter(
    eventId: string,
    claimedAttempt: number,
    maxAttempts: number,
    now: Date,
  ): Promise<boolean>;
  deadLetterCount(maxAttempts: number, eventTypes: readonly SupportedEventType[]): Promise<number>;
  ping(): Promise<void>;
  scheduleDailyBillingReconciliation(input: { now: Date; batchSize: number }): Promise<number>;
  reconcileProEntitlement(input: {
    userId: string;
    eventId: string;
    eventOccurredAt: Date;
    state: ProEntitlementState;
  }): Promise<boolean>;
  completeBillingReconciliationItem(input: {
    itemId: string;
    runId: string;
    userId: string;
    eventId: string;
    mismatch: boolean;
    completedAt: Date;
  }): Promise<void>;
  failBillingReconciliationItem(eventId: string, errorCode: string, failedAt: Date): Promise<void>;
  finalizeSimulationDeadline(input: {
    simulationId: string;
    expectedDeadlineAt: Date;
    eventId: string;
  }): Promise<SimulationDeadlineOutcome>;
  getDataRequest(requestId: string): Promise<DataRequestRecord | null>;
  startDataRequest(input: {
    requestId: string;
    userId: string;
    kind: DataRequestRecord["kind"];
  }): Promise<DataRequestRecord | null>;
  buildUserExportSnapshot(input: {
    requestId: string;
    userId: string;
  }): Promise<DataExportSnapshot>;
  recordDataRequestStep(input: {
    requestId: string;
    userId: string | null;
    step: DataRequestStep;
    phase: string;
    idempotencyKey: string;
    evidence: Record<string, unknown>;
    exportMetadata?: {
      checksumSha256: string;
      sizeBytes: number;
      objectKey: string;
      generation: string;
      expiresAt: Date;
    };
    retentionPolicy?: { id: string; sha256: string };
  }): Promise<void>;
  listUserExportObjects(input: { userId: string }): Promise<readonly PrivacyExportObject[]>;
  recordExportObjectsRevoked(input: {
    deletionRequestId: string;
    userId: string;
    objects: readonly PrivacyExportObject[];
  }): Promise<void>;
  revokeUserAccess(input: { requestId: string; userId: string }): Promise<PrivacySubjects>;
  eraseUserData(input: {
    requestId: string;
    userId: string;
    retentionPolicy: { id: string; sha256: string };
  }): Promise<void>;
  completeDataRequest(input: {
    requestId: string;
    userId: string;
    kind: DataRequestRecord["kind"];
    completedAt: Date;
  }): Promise<boolean>;
}

export interface SafeLogFields {
  eventId?: string;
  eventType?: string;
  attempt?: number;
  claimed?: number;
  processed?: number;
  retried?: number;
  deadLettered?: number;
  durationMs?: number;
  errorCode?: string;
  port?: number;
  status?: string;
}

export type SafeLogMessage =
  | "worker_batch_completed"
  | "worker_batch_failed"
  | "worker_event_dead_lettered"
  | "worker_event_fence_rejected"
  | "worker_event_retry_scheduled"
  | "worker_health_started"
  | "worker_shutdown_forcing"
  | "worker_shutdown_requested"
  | "worker_started"
  | "worker_startup_failed"
  | "worker_stopped";

export interface SafeLogger {
  info(fields: SafeLogFields, message: SafeLogMessage): void;
  warn(fields: SafeLogFields, message: SafeLogMessage): void;
  error(fields: SafeLogFields, message: SafeLogMessage): void;
}

export interface HandlerContext {
  signal: AbortSignal;
}

export type EventHandler = (event: OutboxEvent, context: HandlerContext) => Promise<void>;

export type HandlerRegistry = ReadonlyMap<string, EventHandler>;

export interface RevenueCatLookup {
  readonly environment: "production" | "sandbox";
  lookupPro(customerId: string, signal: AbortSignal): Promise<ProEntitlementState | null>;
}

/**
 * Implementations must make each operation idempotent by requestId. A worker
 * may repeat an operation after a process crash or a lost database lease.
 */
export interface PrivacyAdapter {
  exportUserData(input: {
    requestId: string;
    userId: string;
    signal: AbortSignal;
  }): Promise<void>;
  deleteUserData(input: {
    requestId: string;
    userId: string;
    signal: AbortSignal;
  }): Promise<void>;
}

export interface PrivateObjectStorage {
  putPrivateObject(input: {
    objectKey: string;
    bytes: Uint8Array;
    checksumSha256: string;
    expiresAt: Date;
    signal: AbortSignal;
  }): Promise<{ objectKey: string; generation: string }>;
  deletePrivateObject(input: {
    objectKey: string;
    generation: string;
    signal: AbortSignal;
  }): Promise<void>;
}

export interface PrivacyExportObject {
  requestId: string;
  objectKey: string;
  generation: string;
  checksumSha256: string;
}

export interface ExternalPrivacyProviders {
  eraseAccounts(input: {
    clerkSubject: string;
    revenueCatCustomerId: string;
    signal: AbortSignal;
  }): Promise<void>;
}
