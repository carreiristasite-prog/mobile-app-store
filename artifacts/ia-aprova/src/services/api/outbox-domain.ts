export const OUTBOX_SCHEMA_VERSION = 3 as const;
export const OUTBOX_TTL_MS = 24 * 60 * 60 * 1_000;
export const OUTBOX_MAX_ITEMS = 50;
export const OUTBOX_MAX_BYTES = 128 * 1_024;
export const OUTBOX_MAX_ITEM_BYTES = 4 * 1_024;
export const OUTBOX_MAX_DELIVERY_ATTEMPTS = 5;

export const OUTBOX_OPERATION = 'non_competitive_learning_attempt' as const;
export const OUTBOX_METHOD = 'POST' as const;

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
const ATTEMPT_PATH_RE = new RegExp(`^/api/v1/learning/sessions/(${UUID_PATTERN})/attempts$`, 'i');
const OWNER_NAMESPACE_RE = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export type OfflineAttemptBody = {
  exposureId: string;
  selectedOptionId: string;
  elapsedMs: number;
};

export type OutboxItemState = 'pending' | 'server_rejected' | 'attempts_exhausted';

export type QueuedMutation = {
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  id: string;
  ownerNamespace: string;
  operation: typeof OUTBOX_OPERATION;
  path: string;
  method: typeof OUTBOX_METHOD;
  body: OfflineAttemptBody;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  state: OutboxItemState;
  lastServerStatus?: number;
};

export type OutboxCounters = {
  legacyDiscarded: number;
  unsafeDiscarded: number;
  expiredDiscarded: number;
  capacityRejected: number;
  networkFailures: number;
  ownerPurges: number;
};

export type OutboxEnvelope = {
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  counters: OutboxCounters;
  items: QueuedMutation[];
};

export type OutboxSummary = {
  pending: number;
  serverRejected: number;
  attemptsExhausted: number;
  total: number;
  errors: string[];
};

export type HttpDeliveryDisposition = 'retryable' | 'terminal';

export type ValidationResult =
  | { ok: true; item: QueuedMutation }
  | { ok: false; reason: 'unsafe' | 'expired' };

export class OutboxValidationError extends Error {
  readonly code = 'OUTBOX_MUTATION_NOT_ALLOWED';

  constructor(message = 'Esta ação não pode ser armazenada para envio offline.') {
    super(message);
    this.name = 'OutboxValidationError';
  }
}

export class OutboxCapacityError extends Error {
  readonly code = 'OUTBOX_CAPACITY_REACHED';

  constructor() {
    super('O limite seguro de respostas offline foi atingido. Conecte-se para sincronizar antes de continuar.');
    this.name = 'OutboxCapacityError';
  }
}

export class OutboxTerminalStateError extends Error {
  readonly code = 'OUTBOX_IDEMPOTENCY_TERMINAL';

  constructor() {
    super('Esta resposta offline já exige reconciliação e não pode ser enfileirada novamente.');
    this.name = 'OutboxTerminalStateError';
  }
}

export class OutboxStorageError extends Error {
  readonly code = 'OUTBOX_STORAGE_ERROR';

  constructor(message = 'A fila offline local está indisponível.') {
    super(message);
    this.name = 'OutboxStorageError';
  }
}

export function emptyOutboxEnvelope(): OutboxEnvelope {
  return {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    counters: {
      legacyDiscarded: 0,
      unsafeDiscarded: 0,
      expiredDiscarded: 0,
      capacityRejected: 0,
      networkFailures: 0,
      ownerPurges: 0,
    },
    items: [],
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isSafeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function safeCounter(value: unknown): number {
  return isSafeInteger(value, 0, Number.MAX_SAFE_INTEGER) ? value : 0;
}

export function normalizeCounters(value: unknown): OutboxCounters {
  const record = isPlainRecord(value) ? value : {};
  return {
    legacyDiscarded: safeCounter(record.legacyDiscarded),
    unsafeDiscarded: safeCounter(record.unsafeDiscarded),
    expiredDiscarded: safeCounter(record.expiredDiscarded),
    capacityRejected: safeCounter(record.capacityRejected),
    networkFailures: safeCounter(record.networkFailures),
    ownerPurges: safeCounter(record.ownerPurges),
  };
}

export function incrementCounter(counters: OutboxCounters, key: keyof OutboxCounters, amount = 1): void {
  counters[key] = Math.min(Number.MAX_SAFE_INTEGER, counters[key] + Math.max(0, Math.floor(amount)));
}

/** HTTP connectivity is not delivery success. Retry only statuses that can
 * reasonably recover without changing the immutable mutation payload. */
export function classifyHttpDeliveryStatus(status: number): HttpDeliveryDisposition {
  if (!Number.isSafeInteger(status) || status < 400 || status > 599) return 'terminal';
  return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500
    ? 'retryable'
    : 'terminal';
}

export function sanitizeAttemptBody(value: unknown): OfflineAttemptBody {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['elapsedMs', 'exposureId', 'selectedOptionId'])) {
    throw new OutboxValidationError();
  }
  if (
    typeof value.exposureId !== 'string' || !UUID_RE.test(value.exposureId)
    || typeof value.selectedOptionId !== 'string' || !UUID_RE.test(value.selectedOptionId)
    || !isSafeInteger(value.elapsedMs, 250, 7_200_000)
  ) {
    throw new OutboxValidationError();
  }
  return {
    exposureId: value.exposureId.toLowerCase(),
    selectedOptionId: value.selectedOptionId.toLowerCase(),
    elapsedMs: value.elapsedMs,
  };
}

export function sanitizeOfflineAttempt(input: {
  id: string;
  ownerNamespace: string;
  operation: string;
  path: string;
  method: string;
  body: unknown;
  idempotencyKey: string;
  createdAt?: string;
  nowMs: number;
}): QueuedMutation {
  if (
    input.operation !== OUTBOX_OPERATION
    || input.method !== OUTBOX_METHOD
    || !ATTEMPT_PATH_RE.test(input.path)
    || !OWNER_NAMESPACE_RE.test(input.ownerNamespace)
    || input.ownerNamespace !== input.ownerNamespace.toLowerCase()
    || !IDEMPOTENCY_KEY_RE.test(input.id)
    || input.id !== input.idempotencyKey
    || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)
    || !Number.isSafeInteger(input.nowMs)
  ) {
    throw new OutboxValidationError();
  }

  const body = sanitizeAttemptBody(input.body);
  const canonicalPath = input.path.toLowerCase();
  const createdMs = input.createdAt === undefined ? input.nowMs : Date.parse(input.createdAt);
  if (!Number.isFinite(createdMs) || Math.abs(createdMs - input.nowMs) > 60_000) {
    throw new OutboxValidationError();
  }
  const createdAt = new Date(createdMs).toISOString();
  return {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    id: input.id,
    ownerNamespace: input.ownerNamespace,
    operation: OUTBOX_OPERATION,
    path: canonicalPath,
    method: OUTBOX_METHOD,
    body,
    idempotencyKey: input.idempotencyKey,
    createdAt,
    expiresAt: new Date(createdMs + OUTBOX_TTL_MS).toISOString(),
    attempts: 0,
    state: 'pending',
  };
}

export function validateStoredItem(value: unknown, nowMs: number): ValidationResult {
  if (!isPlainRecord(value)) return { ok: false, reason: 'unsafe' };
  const expectedKeys = [
    'attempts', 'body', 'createdAt', 'expiresAt', 'id', 'idempotencyKey', 'method',
    'operation', 'ownerNamespace', 'path', 'schemaVersion', 'state',
  ];
  if ('lastServerStatus' in value) expectedKeys.push('lastServerStatus');
  if (!hasExactKeys(value, expectedKeys)) return { ok: false, reason: 'unsafe' };

  const createdMs = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : Number.NaN;
  const expiresMs = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN;
  let state = value.state;
  const statusValid = value.lastServerStatus === undefined
    || isSafeInteger(value.lastServerStatus, 400, 599);
  if (
    value.schemaVersion !== OUTBOX_SCHEMA_VERSION
    || typeof value.id !== 'string'
    || typeof value.ownerNamespace !== 'string' || !OWNER_NAMESPACE_RE.test(value.ownerNamespace)
    || value.ownerNamespace !== value.ownerNamespace.toLowerCase()
    || value.operation !== OUTBOX_OPERATION
    || typeof value.path !== 'string' || !ATTEMPT_PATH_RE.test(value.path)
    || value.path !== value.path.toLowerCase()
    || value.method !== OUTBOX_METHOD
    || typeof value.idempotencyKey !== 'string'
    || value.id !== value.idempotencyKey
    || !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)
    || !Number.isFinite(createdMs)
    || !Number.isFinite(expiresMs)
    || createdMs > nowMs + 60_000
    || expiresMs !== createdMs + OUTBOX_TTL_MS
    || !isSafeInteger(value.attempts, 0, OUTBOX_MAX_DELIVERY_ATTEMPTS)
    || !['pending', 'server_rejected', 'attempts_exhausted'].includes(String(state))
    || !statusValid
    || (state === 'server_rejected' && value.lastServerStatus === undefined)
    || (state !== 'server_rejected' && value.lastServerStatus !== undefined)
    || (state === 'server_rejected' && value.attempts < 1)
    || (state === 'attempts_exhausted' && value.attempts !== OUTBOX_MAX_DELIVERY_ATTEMPTS)
  ) {
    return { ok: false, reason: 'unsafe' };
  }
  // v3 originally terminalized every HTTP error. Recover old 401/408/425/429
  // and 5xx records without changing their idempotency key or payload.
  if (state === 'server_rejected' && typeof value.lastServerStatus === 'number'
    && classifyHttpDeliveryStatus(value.lastServerStatus) === 'retryable') {
    state = value.attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS ? 'attempts_exhausted' : 'pending';
  }
  let body: OfflineAttemptBody;
  try {
    body = sanitizeAttemptBody(value.body);
  } catch {
    return { ok: false, reason: 'unsafe' };
  }
  if (nowMs >= expiresMs) return { ok: false, reason: 'expired' };
  const item: QueuedMutation = {
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    id: value.id,
    ownerNamespace: value.ownerNamespace,
    operation: OUTBOX_OPERATION,
    path: value.path,
    method: OUTBOX_METHOD,
    body,
    idempotencyKey: value.idempotencyKey,
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    attempts: value.attempts,
    state: state as OutboxItemState,
  };
  if (state === 'server_rejected' && typeof value.lastServerStatus === 'number') {
    item.lastServerStatus = value.lastServerStatus;
  }
  return { ok: true, item };
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function assertQueueCapacity(envelope: OutboxEnvelope, candidate: QueuedMutation): void {
  if (utf8ByteLength(JSON.stringify(candidate)) > OUTBOX_MAX_ITEM_BYTES) throw new OutboxCapacityError();
  if (envelope.items.length >= OUTBOX_MAX_ITEMS) throw new OutboxCapacityError();
  const next = { ...envelope, items: [...envelope.items, candidate] };
  if (utf8ByteLength(JSON.stringify(next)) > OUTBOX_MAX_BYTES) throw new OutboxCapacityError();
}

export function sameQueuedMutation(left: QueuedMutation, right: QueuedMutation): boolean {
  return left.id === right.id
    && left.ownerNamespace === right.ownerNamespace
    && left.operation === right.operation
    && left.path === right.path
    && left.method === right.method
    && left.idempotencyKey === right.idempotencyKey
    && left.body.exposureId === right.body.exposureId
    && left.body.selectedOptionId === right.body.selectedOptionId
    && left.body.elapsedMs === right.body.elapsedMs;
}

export function summarizeOutbox(envelope: OutboxEnvelope, ownerNamespace: string): OutboxSummary {
  const owned = envelope.items.filter((item) => item.ownerNamespace === ownerNamespace);
  const summary: OutboxSummary = {
    pending: owned.filter((item) => item.state === 'pending').length,
    serverRejected: owned.filter((item) => item.state === 'server_rejected').length,
    attemptsExhausted: owned.filter((item) => item.state === 'attempts_exhausted').length,
    total: owned.length,
    errors: [],
  };
  if (summary.serverRejected > 0) summary.errors.push('SERVER_REJECTED');
  if (summary.attemptsExhausted > 0) summary.errors.push('ATTEMPTS_EXHAUSTED');
  return summary;
}
