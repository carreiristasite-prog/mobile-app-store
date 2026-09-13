import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { discardLegacyOutboxQueues } from './outbox-legacy-migration';
import {
  OUTBOX_MAX_BYTES,
  OUTBOX_MAX_DELIVERY_ATTEMPTS,
  OUTBOX_MAX_ITEM_BYTES,
  OUTBOX_MAX_ITEMS,
  OUTBOX_OPERATION,
  OutboxCapacityError,
  OutboxStorageError,
  OutboxTerminalStateError,
  OutboxValidationError,
  assertQueueCapacity,
  classifyHttpDeliveryStatus,
  emptyOutboxEnvelope,
  incrementCounter,
  sameQueuedMutation,
  sanitizeOfflineAttempt,
  summarizeOutbox,
  utf8ByteLength,
  validateStoredItem,
  type OutboxCounters,
  type OutboxEnvelope,
  type OutboxSummary,
  type QueuedMutation,
} from './outbox-domain';

const DATABASE_NAME = 'ia_aprova_outbox_v3.db';
const SQLITE_STORAGE_VERSION = 3;
const STORAGE_SCHEMA_MARKER = 'sqlite_storage_schema_version';
const LEGACY_PURGE_MARKER = 'legacy_async_storage_v1_v3_discarded';
const OWNER_NAMESPACE_PREFIX = 'ia-aprova-outbox-owner-v1:';
const OWNER_NAMESPACE_RE = /^[0-9a-f]{64}$/;

const DATABASE_SCHEMA = `
  CREATE TABLE outbox_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    integer_value INTEGER NOT NULL CHECK (integer_value >= 0)
  ) STRICT;

  CREATE TABLE outbox_counters (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    legacy_discarded INTEGER NOT NULL DEFAULT 0 CHECK (legacy_discarded >= 0),
    unsafe_discarded INTEGER NOT NULL DEFAULT 0 CHECK (unsafe_discarded >= 0),
    expired_discarded INTEGER NOT NULL DEFAULT 0 CHECK (expired_discarded >= 0),
    capacity_rejected INTEGER NOT NULL DEFAULT 0 CHECK (capacity_rejected >= 0),
    network_failures INTEGER NOT NULL DEFAULT 0 CHECK (network_failures >= 0),
    owner_purges INTEGER NOT NULL DEFAULT 0 CHECK (owner_purges >= 0)
  ) STRICT;

  INSERT INTO outbox_metadata (key, integer_value)
    VALUES ('${STORAGE_SCHEMA_MARKER}', ${SQLITE_STORAGE_VERSION});
  INSERT INTO outbox_counters (singleton) VALUES (1);

  CREATE TABLE outbox_items (
    owner_namespace TEXT NOT NULL CHECK (length(owner_namespace) = 64),
    id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'server_rejected', 'attempts_exhausted')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    item_json TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= ${OUTBOX_MAX_ITEM_BYTES}),
    PRIMARY KEY (owner_namespace, id)
  ) STRICT;

  CREATE INDEX idx_outbox_owner_state_expires
    ON outbox_items (owner_namespace, state, expires_at);
  CREATE INDEX idx_outbox_expires
    ON outbox_items (expires_at);
`;

const REQUIRED_SCHEMA_OBJECTS = [
  'outbox_metadata',
  'outbox_counters',
  'outbox_items',
  'idx_outbox_owner_state_expires',
  'idx_outbox_expires',
] as const;

type StoredItemRow = {
  owner_namespace: string;
  id: string;
  state: string;
  expires_at: string;
  created_at: string;
  item_json: string;
  byte_size: number;
};

type CounterRow = {
  legacy_discarded: number;
  unsafe_discarded: number;
  expired_discarded: number;
  capacity_rejected: number;
  network_failures: number;
  owner_purges: number;
};

type VersionRow = { user_version: number };
type SchemaObjectRow = { name: string };
type MetadataRow = { integer_value: number };

type EnvelopeOperation<T> = {
  result?: T;
  write?: boolean;
  deferredError?: Error;
};

let storageQueue: Promise<unknown> = Promise.resolve();
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.catch(() => undefined);
  return result;
}

function storageFailure(message: string): OutboxStorageError {
  return new OutboxStorageError(message);
}

function safeCounter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw storageFailure('Os contadores da fila offline local são inválidos.');
  }
  return value;
}

function countersFromRow(row: CounterRow | null): OutboxCounters {
  if (!row) throw storageFailure('A fila offline local está indisponível.');
  return {
    legacyDiscarded: safeCounter(row.legacy_discarded),
    unsafeDiscarded: safeCounter(row.unsafe_discarded),
    expiredDiscarded: safeCounter(row.expired_discarded),
    capacityRejected: safeCounter(row.capacity_rejected),
    networkFailures: safeCounter(row.network_failures),
    ownerPurges: safeCounter(row.owner_purges),
  };
}

async function verifySchema(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<SchemaObjectRow>(
    `SELECT name FROM sqlite_master
     WHERE name IN (${REQUIRED_SCHEMA_OBJECTS.map(() => '?').join(', ')})`,
    ...REQUIRED_SCHEMA_OBJECTS,
  );
  const found = new Set(rows.map((row) => row.name));
  if (REQUIRED_SCHEMA_OBJECTS.some((name) => !found.has(name))) {
    throw storageFailure('A versão local da fila offline é inválida.');
  }
  const marker = await db.getFirstAsync<MetadataRow>(
    'SELECT integer_value FROM outbox_metadata WHERE key = ?',
    STORAGE_SCHEMA_MARKER,
  );
  if (!marker || marker.integer_value !== SQLITE_STORAGE_VERSION) {
    throw storageFailure('O schema local da fila offline é inválido.');
  }
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
  try {
    // WAL improves concurrency when supported. Exclusive transactions below
    // remain the correctness boundary when a platform rejects this pragma.
    await db.execAsync('PRAGMA journal_mode = WAL;');
  } catch {
    // Do not claim WAL on targets that do not support it.
  }

  await db.withExclusiveTransactionAsync(async (transaction) => {
    const version = await transaction.getFirstAsync<VersionRow>('PRAGMA user_version');
    if (!version || !Number.isSafeInteger(version.user_version)) {
      throw storageFailure('Não foi possível verificar a fila offline local.');
    }
    if (version.user_version === 0) {
      await transaction.execAsync(DATABASE_SCHEMA);
      await transaction.execAsync(`PRAGMA user_version = ${SQLITE_STORAGE_VERSION};`);
      return;
    }
    if (version.user_version !== SQLITE_STORAGE_VERSION) {
      // Unknown SQLite schemas are never transformed or replayed.
      throw storageFailure('A versão local da fila offline não é compatível.');
    }
  });
  await verifySchema(db);

  const marker = await db.getFirstAsync<MetadataRow>(
    'SELECT integer_value FROM outbox_metadata WHERE key = ?',
    LEGACY_PURGE_MARKER,
  );
  if (marker && marker.integer_value !== 1) {
    throw storageFailure('O marcador de migração da fila offline é inválido.');
  }
  if (!marker) {
    // This migration only erases AsyncStorage v1-v3. If deletion fails,
    // initialization fails closed and no SQLite operation can continue.
    await discardLegacyOutboxQueues();
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        'INSERT INTO outbox_metadata (key, integer_value) VALUES (?, 1)',
        LEGACY_PURGE_MARKER,
      );
    });
  }
  return db;
}

function database(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeDatabase().catch((error) => {
      databasePromise = null;
      throw error instanceof OutboxStorageError
        ? error
        : storageFailure('Não foi possível abrir a fila offline local.');
    });
  }
  return databasePromise;
}

function serializedItem(item: QueuedMutation): string {
  return JSON.stringify(item);
}

function assertEnvelopeCapacity(envelope: OutboxEnvelope): void {
  if (envelope.items.length > OUTBOX_MAX_ITEMS) throw new OutboxCapacityError();
  for (const item of envelope.items) {
    if (utf8ByteLength(serializedItem(item)) > OUTBOX_MAX_ITEM_BYTES) throw new OutboxCapacityError();
  }
  if (utf8ByteLength(JSON.stringify(envelope)) > OUTBOX_MAX_BYTES) throw new OutboxCapacityError();
}

async function readEnvelope(
  transaction: SQLite.SQLiteDatabase,
  nowMs: number,
): Promise<{ envelope: OutboxEnvelope; changed: boolean }> {
  const counterRow = await transaction.getFirstAsync<CounterRow>(
    `SELECT legacy_discarded, unsafe_discarded, expired_discarded,
            capacity_rejected, network_failures, owner_purges
       FROM outbox_counters WHERE singleton = 1`,
  );
  const envelope = emptyOutboxEnvelope();
  envelope.counters = countersFromRow(counterRow);
  const rows = await transaction.getAllAsync<StoredItemRow>(
    `SELECT owner_namespace, id, state, expires_at, created_at, item_json, byte_size
       FROM outbox_items ORDER BY created_at ASC, id ASC`,
  );
  let changed = false;
  if (rows.length > OUTBOX_MAX_ITEMS) {
    incrementCounter(envelope.counters, 'unsafeDiscarded', rows.length);
    return { envelope, changed: true };
  }
  const identities = new Set<string>();
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.item_json);
    } catch {
      incrementCounter(envelope.counters, 'unsafeDiscarded');
      changed = true;
      continue;
    }
    const validation = validateStoredItem(parsed, nowMs);
    if (!validation.ok) {
      incrementCounter(envelope.counters, validation.reason === 'expired' ? 'expiredDiscarded' : 'unsafeDiscarded');
      changed = true;
      continue;
    }
    const item = validation.item;
    const canonical = serializedItem(item);
    const identity = `${item.ownerNamespace}:${item.id}`;
    if (
      identities.has(identity)
      || row.owner_namespace !== item.ownerNamespace
      || row.id !== item.id
      || row.state !== item.state
      || row.expires_at !== item.expiresAt
      || row.created_at !== item.createdAt
      || row.byte_size !== utf8ByteLength(row.item_json)
      || utf8ByteLength(canonical) > OUTBOX_MAX_ITEM_BYTES
    ) {
      incrementCounter(envelope.counters, 'unsafeDiscarded');
      changed = true;
      continue;
    }
    identities.add(identity);
    if (canonical !== row.item_json) changed = true;
    envelope.items.push(item);
  }
  if (utf8ByteLength(JSON.stringify(envelope)) > OUTBOX_MAX_BYTES) {
    incrementCounter(envelope.counters, 'unsafeDiscarded', envelope.items.length || 1);
    envelope.items = [];
    changed = true;
  }
  return { envelope, changed };
}

async function writeEnvelope(transaction: SQLite.SQLiteDatabase, envelope: OutboxEnvelope): Promise<void> {
  assertEnvelopeCapacity(envelope);
  await transaction.runAsync('DELETE FROM outbox_items');
  for (const item of envelope.items) {
    const itemJson = serializedItem(item);
    await transaction.runAsync(
      `INSERT INTO outbox_items
        (owner_namespace, id, state, expires_at, created_at, item_json, byte_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      item.ownerNamespace,
      item.id,
      item.state,
      item.expiresAt,
      item.createdAt,
      itemJson,
      utf8ByteLength(itemJson),
    );
  }
  await transaction.runAsync(
    `UPDATE outbox_counters SET
       legacy_discarded = ?, unsafe_discarded = ?, expired_discarded = ?,
       capacity_rejected = ?, network_failures = ?, owner_purges = ?
     WHERE singleton = 1`,
    envelope.counters.legacyDiscarded,
    envelope.counters.unsafeDiscarded,
    envelope.counters.expiredDiscarded,
    envelope.counters.capacityRejected,
    envelope.counters.networkFailures,
    envelope.counters.ownerPurges,
  );
}

async function withEnvelope<T>(
  operation: (envelope: OutboxEnvelope) => Promise<EnvelopeOperation<T>> | EnvelopeOperation<T>,
): Promise<T> {
  const db = await database();
  let output: T | undefined;
  let deferredError: Error | undefined;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const loaded = await readEnvelope(transaction, Date.now());
    const next = await operation(loaded.envelope);
    if (loaded.changed || next.write) await writeEnvelope(transaction, loaded.envelope);
    output = next.result;
    deferredError = next.deferredError;
  });
  if (deferredError) throw deferredError;
  return output as T;
}

async function ownerNamespaceFor(ownerId: string): Promise<string> {
  const normalized = ownerId.trim();
  if (!normalized || normalized !== ownerId || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new OutboxValidationError('A fila offline exige uma conta ativa válida.');
  }
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${OWNER_NAMESPACE_PREFIX}${normalized}`,
  );
}

function assertOwnerNamespace(ownerNamespace: string): void {
  if (!OWNER_NAMESPACE_RE.test(ownerNamespace)) {
    throw new OutboxValidationError('A fila offline exige uma conta ativa válida.');
  }
}

function findOwned(envelope: OutboxEnvelope, ownerNamespace: string, id: string): QueuedMutation | undefined {
  return envelope.items.find((item) => item.ownerNamespace === ownerNamespace && item.id === id);
}

export const apiOutbox = {
  ownerNamespaceFor,

  async summary(ownerNamespace: string): Promise<OutboxSummary> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => ({ result: summarizeOutbox(envelope, ownerNamespace) })));
  },

  async summaryForOwnerId(ownerId: string): Promise<OutboxSummary> {
    return this.summary(await ownerNamespaceFor(ownerId));
  },

  async deliverable(ownerNamespace: string): Promise<QueuedMutation[]> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => ({
      result: envelope.items
        .filter((item) => item.ownerNamespace === ownerNamespace && item.state === 'pending')
        .map((item) => ({ ...item, body: { ...item.body } })),
    })));
  },

  async enqueue(input: {
    id: string;
    ownerNamespace: string;
    operation: typeof OUTBOX_OPERATION;
    path: string;
    method: string;
    body: unknown;
    idempotencyKey: string;
  }): Promise<QueuedMutation> {
    return serialized(() => withEnvelope((envelope) => {
      const candidate = sanitizeOfflineAttempt({ ...input, nowMs: Date.now() });
      const existing = findOwned(envelope, input.ownerNamespace, input.id);
      if (existing) {
        if (!sameQueuedMutation(existing, candidate)) throw new OutboxValidationError('A chave offline já foi usada com outro payload.');
        if (existing.state !== 'pending') throw new OutboxTerminalStateError();
        return { result: existing };
      }
      try {
        assertQueueCapacity(envelope, candidate);
      } catch (error) {
        incrementCounter(envelope.counters, 'capacityRejected');
        return {
          write: true,
          deferredError: error instanceof Error ? error : new OutboxCapacityError(),
        };
      }
      envelope.items.push(candidate);
      return { result: candidate, write: true };
    }));
  },

  async beginDelivery(id: string, ownerNamespace: string): Promise<QueuedMutation | null> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const item = findOwned(envelope, ownerNamespace, id);
      if (!item || item.state !== 'pending') return { result: null };
      if (item.attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS) {
        item.state = 'attempts_exhausted';
        return { result: null, write: true };
      }
      item.attempts += 1;
      return { result: { ...item, body: { ...item.body } }, write: true };
    }));
  },

  async revalidateDelivery(expected: QueuedMutation, ownerNamespace: string): Promise<void> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const current = findOwned(envelope, ownerNamespace, expected.id);
      if (!current || current.state !== 'pending' || !sameQueuedMutation(current, expected)
        || current.attempts !== expected.attempts || current.expiresAt !== expected.expiresAt) {
        throw new OutboxValidationError('A resposta offline mudou ou expirou antes do envio.');
      }
      return { result: undefined };
    }));
  },

  async markNetworkFailure(id: string, ownerNamespace: string): Promise<void> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const item = findOwned(envelope, ownerNamespace, id);
      if (!item || item.state !== 'pending') return { result: undefined };
      incrementCounter(envelope.counters, 'networkFailures');
      if (item.attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS) item.state = 'attempts_exhausted';
      return { result: undefined, write: true };
    }));
  },

  async markRetryableHttpFailure(id: string, ownerNamespace: string): Promise<void> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const item = findOwned(envelope, ownerNamespace, id);
      if (!item || item.state !== 'pending') return { result: undefined };
      if (item.attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS) item.state = 'attempts_exhausted';
      return { result: undefined, write: true };
    }));
  },

  async markServerRejected(id: string, ownerNamespace: string, status: number): Promise<void> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const item = findOwned(envelope, ownerNamespace, id);
      if (!item || item.state !== 'pending') return { result: undefined };
      const safeStatus = Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : 500;
      if (classifyHttpDeliveryStatus(safeStatus) === 'retryable') {
        if (item.attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS) item.state = 'attempts_exhausted';
        return { result: undefined, write: true };
      }
      item.state = 'server_rejected';
      item.lastServerStatus = safeStatus;
      return { result: undefined, write: true };
    }));
  },

  async removeDelivered(id: string, ownerNamespace: string): Promise<void> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const before = envelope.items.length;
      envelope.items = envelope.items.filter((item) => !(item.ownerNamespace === ownerNamespace && item.id === id));
      return { result: undefined, write: envelope.items.length !== before };
    }));
  },

  async clear(ownerNamespace: string): Promise<number> {
    assertOwnerNamespace(ownerNamespace);
    return serialized(() => withEnvelope((envelope) => {
      const before = envelope.items.length;
      envelope.items = envelope.items.filter((item) => item.ownerNamespace !== ownerNamespace);
      const removed = before - envelope.items.length;
      if (removed > 0) incrementCounter(envelope.counters, 'ownerPurges');
      return { result: removed, write: removed > 0 };
    }));
  },

  async clearForOwnerId(ownerId: string): Promise<number> {
    return this.clear(await ownerNamespaceFor(ownerId));
  },
};

export type { OutboxSummary, QueuedMutation } from './outbox-domain';
