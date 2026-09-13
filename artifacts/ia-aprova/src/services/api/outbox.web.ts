import * as Crypto from 'expo-crypto';
import {
  OUTBOX_OPERATION,
  OutboxValidationError,
  type OutboxSummary,
  type QueuedMutation,
} from './outbox-domain';

const OWNER_NAMESPACE_PREFIX = 'ia-aprova-outbox-owner-v1:';
const EMPTY_SUMMARY: OutboxSummary = {
  pending: 0,
  serverRejected: 0,
  attemptsExhausted: 0,
  total: 0,
  errors: [],
};

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

function noWebQueue(): never {
  throw new OutboxValidationError('O envio offline não está disponível na versão web.');
}

/** Web intentionally has no persistent or in-memory outbox. */
export const apiOutbox = {
  ownerNamespaceFor,
  async summary(_ownerNamespace: string): Promise<OutboxSummary> { return { ...EMPTY_SUMMARY, errors: [] }; },
  async summaryForOwnerId(ownerId: string): Promise<OutboxSummary> {
    await ownerNamespaceFor(ownerId);
    return { ...EMPTY_SUMMARY, errors: [] };
  },
  async deliverable(_ownerNamespace: string): Promise<QueuedMutation[]> { return []; },
  async enqueue(_input: {
    id: string;
    ownerNamespace: string;
    operation: typeof OUTBOX_OPERATION;
    path: string;
    method: string;
    body: unknown;
    idempotencyKey: string;
  }): Promise<QueuedMutation> { return noWebQueue(); },
  async beginDelivery(_id: string, _ownerNamespace: string): Promise<QueuedMutation | null> { return null; },
  async revalidateDelivery(_expected: QueuedMutation, _ownerNamespace: string): Promise<void> { noWebQueue(); },
  async markNetworkFailure(_id: string, _ownerNamespace: string): Promise<void> {},
  async markRetryableHttpFailure(_id: string, _ownerNamespace: string): Promise<void> {},
  async markServerRejected(_id: string, _ownerNamespace: string, _status: number): Promise<void> {},
  async removeDelivered(_id: string, _ownerNamespace: string): Promise<void> {},
  async clear(_ownerNamespace: string): Promise<number> { return 0; },
  async clearForOwnerId(ownerId: string): Promise<number> {
    await ownerNamespaceFor(ownerId);
    return 0;
  },
};

export type { OutboxSummary, QueuedMutation } from './outbox-domain';
