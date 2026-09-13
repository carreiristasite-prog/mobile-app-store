import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OUTBOX_MAX_DELIVERY_ATTEMPTS,
  OUTBOX_MAX_ITEMS,
  OUTBOX_OPERATION,
  OUTBOX_SCHEMA_VERSION,
  OUTBOX_TTL_MS,
  OutboxCapacityError,
  OutboxStorageError,
  OutboxValidationError,
  assertQueueCapacity,
  classifyHttpDeliveryStatus,
  emptyOutboxEnvelope,
  sanitizeOfflineAttempt,
  summarizeOutbox,
  utf8ByteLength,
  validateStoredItem,
  type QueuedMutation,
} from '../src/services/api/outbox-domain.ts';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');
const OWNER = 'a'.repeat(64);
const SESSION = '11111111-1111-4111-8111-111111111111';
const EXPOSURE = '22222222-2222-4222-8222-222222222222';
const OPTION = '33333333-3333-4333-8333-333333333333';

function makeItem(overrides: Record<string, unknown> = {}): QueuedMutation {
  return sanitizeOfflineAttempt({
    id: 'mobile-44444444-4444-4444-8444-444444444444',
    ownerNamespace: OWNER,
    operation: OUTBOX_OPERATION,
    path: `/api/v1/learning/sessions/${SESSION}/attempts`,
    method: 'POST',
    body: { exposureId: EXPOSURE, selectedOptionId: OPTION, elapsedMs: 1_500 },
    idempotencyKey: 'mobile-44444444-4444-4444-8444-444444444444',
    nowMs: NOW,
    ...overrides,
  });
}

test('storage failure is distinct from an invalid mutation', () => {
  const failure = new OutboxStorageError();
  assert.equal(failure.code, 'OUTBOX_STORAGE_ERROR');
  assert.equal(failure instanceof OutboxValidationError, false);
});

test('accepts only the non-competitive attempt contract and strips prototypes', () => {
  const body = Object.create(null) as Record<string, unknown>;
  body.exposureId = EXPOSURE.toUpperCase();
  body.selectedOptionId = OPTION.toUpperCase();
  body.elapsedMs = 1_500;
  const item = makeItem({ body });
  assert.equal(item.schemaVersion, OUTBOX_SCHEMA_VERSION);
  assert.equal(item.method, 'POST');
  assert.equal(item.operation, OUTBOX_OPERATION);
  assert.deepEqual(item.body, { exposureId: EXPOSURE, selectedOptionId: OPTION, elapsedMs: 1_500 });
  assert.equal(Object.getPrototypeOf(item.body), Object.prototype);
  assert.equal(Date.parse(item.expiresAt) - Date.parse(item.createdAt), OUTBOX_TTL_MS);
});

test('rejects every non-allowlisted method and sensitive route family', () => {
  const forbidden = [
    ['DELETE', `/api/v1/learning/sessions/${SESSION}/attempts`],
    ['POST', '/api/v1/billing/restore'],
    ['POST', '/api/v1/reports'],
    ['DELETE', '/api/v1/me'],
    ['POST', '/api/v1/me/export'],
    ['POST', '/api/v1/me/guardian-invitations'],
    ['POST', '/api/v1/social/summary'],
  ];
  for (const [method, path] of forbidden) {
    assert.throws(() => makeItem({ method, path }), OutboxValidationError);
  }
});

test('rejects path encoding, query, fragment and traversal variants', () => {
  const canonical = `/api/v1/learning/sessions/${SESSION}/attempts`;
  for (const path of [
    `${canonical}?next=/api/v1/billing/restore`,
    `${canonical}#fragment`,
    `${canonical}/`,
    canonical.replace('/sessions/', '/sessions//'),
    canonical.replace('/attempts', '/%61ttempts'),
    canonical.replace(`/sessions/${SESSION}`, `/sessions/../sessions/${SESSION}`),
    `https://attacker.invalid${canonical}`,
  ]) {
    assert.throws(() => makeItem({ path }), OutboxValidationError);
  }
});

test('rejects competitive or unclassified operation labels', () => {
  for (const operation of ['simulation_attempt', 'duel_attempt', 'social', '', 'learning_attempt']) {
    assert.throws(() => makeItem({ operation }), OutboxValidationError);
  }
});

test('body is closed and never accepts token, PII, answer key or authority fields', () => {
  const forbiddenFields = ['token', 'email', 'guardianToken', 'correctOptionId', 'isCorrect', 'score', 'xp', 'premium'];
  for (const field of forbiddenFields) {
    assert.throws(() => makeItem({
      body: { exposureId: EXPOSURE, selectedOptionId: OPTION, elapsedMs: 1_500, [field]: 'secret' },
    }), OutboxValidationError);
  }
  assert.throws(() => makeItem({ body: { exposureId: EXPOSURE, selectedOptionId: OPTION, elapsedMs: 249 } }), OutboxValidationError);
  assert.throws(() => makeItem({ body: { exposureId: EXPOSURE, selectedOptionId: OPTION, elapsedMs: 7_200_001 } }), OutboxValidationError);
  assert.throws(() => makeItem({ body: { exposureId: 'not-a-uuid', selectedOptionId: OPTION, elapsedMs: 1_500 } }), OutboxValidationError);
  for (const elapsedMs of [Number.NaN, Number.POSITIVE_INFINITY, 1_500.5, '1500', null]) {
    assert.throws(() => makeItem({ body: { exposureId: EXPOSURE, selectedOptionId: OPTION, elapsedMs } }), OutboxValidationError);
  }
  class AttemptBody {
    exposureId = EXPOSURE;
    selectedOptionId = OPTION;
    elapsedMs = 1_500;
  }
  assert.throws(() => makeItem({ body: new AttemptBody() }), OutboxValidationError);
});

test('owner namespace and idempotency key are mandatory and opaque', () => {
  assert.throws(() => makeItem({ ownerNamespace: 'user_123' }), OutboxValidationError);
  assert.throws(() => makeItem({ ownerNamespace: '' }), OutboxValidationError);
  assert.throws(() => makeItem({ idempotencyKey: 'Bearer secret' }), OutboxValidationError);
  assert.throws(() => makeItem({ idempotencyKey: 'mobile-other-key' }), OutboxValidationError);
  assert.throws(() => makeItem({ ownerNamespace: OWNER.toUpperCase() }), OutboxValidationError);
  assert.throws(() => makeItem({ id: 'mobile-key\r\nInjected: yes', idempotencyKey: 'mobile-key\r\nInjected: yes' }), OutboxValidationError);
});

test('stored schema is fail-closed, versioned and expires exactly at TTL', () => {
  const item = makeItem();
  assert.equal(validateStoredItem(item, NOW + OUTBOX_TTL_MS - 1).ok, true);
  assert.deepEqual(validateStoredItem(item, NOW + OUTBOX_TTL_MS), { ok: false, reason: 'expired' });
  assert.deepEqual(validateStoredItem({ ...item, schemaVersion: 2 }, NOW), { ok: false, reason: 'unsafe' });
  assert.deepEqual(validateStoredItem({ ...item, ownerId: 'user_123' }, NOW), { ok: false, reason: 'unsafe' });
  assert.deepEqual(validateStoredItem({ ...item, expiresAt: new Date(NOW + OUTBOX_TTL_MS + 1).toISOString() }, NOW), { ok: false, reason: 'unsafe' });
  assert.deepEqual(validateStoredItem({ ...item, createdAt: new Date(NOW + 60_001).toISOString(), expiresAt: new Date(NOW + 60_001 + OUTBOX_TTL_MS).toISOString() }, NOW), { ok: false, reason: 'unsafe' });
});

test('clock rollback cannot extend an already stored item', () => {
  const item = makeItem();
  assert.deepEqual(validateStoredItem(item, NOW - 60_001), { ok: false, reason: 'unsafe' });
  assert.deepEqual(validateStoredItem(item, NOW + OUTBOX_TTL_MS), { ok: false, reason: 'expired' });
});

test('retryable HTTP statuses are distinct from terminal contract rejection', () => {
  for (const status of [401, 408, 425, 429, 500, 502, 503, 599]) {
    assert.equal(classifyHttpDeliveryStatus(status), 'retryable', String(status));
  }
  for (const status of [400, 403, 404, 409, 410, 418, 422, 499, 200, Number.NaN]) {
    assert.equal(classifyHttpDeliveryStatus(status), 'terminal', String(status));
  }
});

test('stored v3 retryable rejection is recovered for idempotent replay', () => {
  const item = makeItem();
  const recovered = validateStoredItem({ ...item, state: 'server_rejected', attempts: 2, lastServerStatus: 503 }, NOW);
  assert.equal(recovered.ok, true);
  if (recovered.ok) {
    assert.equal(recovered.item.state, 'pending');
    assert.equal(recovered.item.attempts, 2);
    assert.equal(recovered.item.lastServerStatus, undefined);
    assert.equal(recovered.item.idempotencyKey, item.idempotencyKey);
  }
  const exhausted = validateStoredItem({ ...item, state: 'server_rejected', attempts: 5, lastServerStatus: 429 }, NOW);
  assert.equal(exhausted.ok, true);
  if (exhausted.ok) assert.equal(exhausted.item.state, 'attempts_exhausted');
});

test('terminal states require bounded, internally consistent attempts', () => {
  const item = makeItem();
  assert.deepEqual(validateStoredItem({ ...item, attempts: OUTBOX_MAX_DELIVERY_ATTEMPTS + 1 }, NOW), { ok: false, reason: 'unsafe' });
  assert.deepEqual(validateStoredItem({ ...item, state: 'server_rejected', lastServerStatus: 409, attempts: 0 }, NOW), { ok: false, reason: 'unsafe' });
  assert.equal(validateStoredItem({ ...item, state: 'server_rejected', lastServerStatus: 409, attempts: 1 }, NOW).ok, true);
  assert.deepEqual(validateStoredItem({ ...item, state: 'attempts_exhausted', attempts: 4 }, NOW), { ok: false, reason: 'unsafe' });
  assert.equal(validateStoredItem({ ...item, state: 'attempts_exhausted', attempts: 5 }, NOW).ok, true);
});

test('capacity fails closed without modifying the existing queue', () => {
  const envelope = emptyOutboxEnvelope();
  const item = makeItem();
  envelope.items = Array.from({ length: OUTBOX_MAX_ITEMS }, (_, index) => ({
    ...item,
    id: `mobile-${String(index).padStart(8, '0')}-4444-4444-8444-444444444444`,
    idempotencyKey: `mobile-${String(index).padStart(8, '0')}-4444-4444-8444-444444444444`,
  }));
  const before = JSON.stringify(envelope);
  assert.throws(() => assertQueueCapacity(envelope, item), OutboxCapacityError);
  assert.equal(JSON.stringify(envelope), before);
});

test('summary exposes counts and opaque codes, never queued payload data', () => {
  const pending = makeItem();
  const rejected = { ...makeItem({ id: 'mobile-55555555-5555-4555-8555-555555555555', idempotencyKey: 'mobile-55555555-5555-4555-8555-555555555555' }), state: 'server_rejected' as const, attempts: 1, lastServerStatus: 409 };
  const exhausted = { ...makeItem({ id: 'mobile-66666666-6666-4666-8666-666666666666', idempotencyKey: 'mobile-66666666-6666-4666-8666-666666666666' }), state: 'attempts_exhausted' as const, attempts: 5 };
  const envelope = { ...emptyOutboxEnvelope(), items: [pending, rejected, exhausted] };
  const summary = summarizeOutbox(envelope, OWNER);
  assert.deepEqual({ pending: summary.pending, rejected: summary.serverRejected, exhausted: summary.attemptsExhausted, total: summary.total }, { pending: 1, rejected: 1, exhausted: 1, total: 3 });
  assert.deepEqual(summary.errors, ['SERVER_REJECTED', 'ATTEMPTS_EXHAUSTED']);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(EXPOSURE), false);
  assert.equal(serialized.includes(OPTION), false);
  assert.equal(serialized.includes(OWNER), false);
  assert.equal('counters' in summary, false);
});

test('summary never exposes another owner or global device diagnostics', () => {
  const otherOwner = 'b'.repeat(64);
  const envelope = emptyOutboxEnvelope();
  envelope.counters.unsafeDiscarded = 7;
  envelope.items = [{ ...makeItem(), ownerNamespace: otherOwner }];
  assert.deepEqual(summarizeOutbox(envelope, OWNER), {
    pending: 0,
    serverRejected: 0,
    attemptsExhausted: 0,
    total: 0,
    errors: [],
  });
});

test('UTF-8 accounting is deterministic for ASCII and multibyte input', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('ação'), 6);
  assert.equal(utf8ByteLength('🔐'), 4);
  assert.equal(utf8ByteLength('\ud800'), 3);
});
