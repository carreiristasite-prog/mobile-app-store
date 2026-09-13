import { apiOutbox } from './outbox';
import * as Crypto from 'expo-crypto';
import {
  OUTBOX_OPERATION,
  OutboxValidationError,
  classifyHttpDeliveryStatus,
  type OutboxSummary,
} from './outbox-domain';
import {
  ApiConfigurationError,
  ApiError,
  ApiNetworkError,
  ApiSessionChangedError,
  type ApiNetworkState,
  type MutationResult,
  type ProblemDetails,
} from './types';

type TokenProvider = () => Promise<string | null>;
type NetworkListener = (state: ApiNetworkState) => void;
type CurrentOwnerProvider = () => string | null;

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  authenticated?: boolean;
  idempotencyKey?: string;
  timeoutMs?: number;
  beforeAuthenticatedFetch?: () => Promise<void>;
};

type MutationOptions = RequestOptions & {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  queueWhenOffline?: false;
  offlineQueue?: typeof OUTBOX_OPERATION;
};

const JSON_CONTENT_TYPE = 'application/json';

function makeIdempotencyKey(): string {
  return `mobile-${Crypto.randomUUID()}`;
}

function normalizeBaseUrl(value?: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!__DEV__ && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    // Public paths already include `/api`; accepting a base path here would
    // silently generate `/api/api/v1/...` or target a different gateway.
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isProblemDetails(value: unknown): value is Partial<ProblemDetails> {
  return Boolean(value && typeof value === 'object' && ('title' in value || 'detail' in value));
}

export class ApiClient {
  readonly configured: boolean;
  private readonly baseUrl: string | null;
  private readonly getToken: TokenProvider;
  private readonly onNetworkState: NetworkListener;
  private readonly ownerId: string | null;
  private readonly getCurrentOwnerId: CurrentOwnerProvider;

  constructor(
    baseUrl: string | undefined,
    getToken: TokenProvider,
    onNetworkState: NetworkListener,
    ownerId: string | null,
    getCurrentOwnerId: CurrentOwnerProvider,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.configured = Boolean(this.baseUrl);
    this.getToken = getToken;
    this.onNetworkState = onNetworkState;
    this.ownerId = ownerId || null;
    this.getCurrentOwnerId = getCurrentOwnerId;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.baseUrl) throw new ApiConfigurationError();

    const {
      authenticated = true,
      body,
      headers: providedHeaders,
      idempotencyKey,
      timeoutMs = 15_000,
      beforeAuthenticatedFetch,
      ...init
    } = options;
    const headers = new Headers(providedHeaders);
    headers.set('Accept', JSON_CONTENT_TYPE);
    if (body !== undefined) headers.set('Content-Type', JSON_CONTENT_TYPE);
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

    if (authenticated) {
      if (this.getCurrentOwnerId() !== this.ownerId) throw new ApiSessionChangedError();
      const token = await this.getToken();
      // `getToken()` is asynchronous. Re-check immediately before starting
      // the request so an old screen/outbox cannot use the next account's
      // active Clerk token during a fast account switch.
      if (this.getCurrentOwnerId() !== this.ownerId) throw new ApiSessionChangedError();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (beforeAuthenticatedFetch) await beforeAuthenticatedFetch();
      if (this.getCurrentOwnerId() !== this.ownerId) throw new ApiSessionChangedError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      this.onNetworkState('online');

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const problem: ProblemDetails = isProblemDetails(payload)
          ? {
              title: payload.title || `Erro ${response.status}`,
              // The transport status is authoritative. A response body must
              // never downgrade a retryable 5xx/429 into a terminal 4xx.
              status: response.status,
              detail: payload.detail,
              type: payload.type,
              instance: payload.instance,
              code: payload.code,
              errors: payload.errors,
              traceId: payload.traceId,
              requestId: payload.requestId,
            }
          : { title: 'Não foi possível concluir a solicitação.', status: response.status };
        throw new ApiError(problem);
      }

      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (error instanceof ApiError || error instanceof ApiSessionChangedError) throw error;
      this.onNetworkState('offline');
      throw new ApiNetworkError(error instanceof Error && error.name === 'AbortError'
        ? 'A conexão demorou demais. Tente novamente.'
        : undefined);
    } finally {
      clearTimeout(timeout);
    }
  }

  async mutate<T>(path: string, options: MutationOptions): Promise<MutationResult<T>> {
    const idempotencyKey = options.idempotencyKey || makeIdempotencyKey();
    const { offlineQueue, queueWhenOffline: _queueWhenOffline, ...requestOptions } = options;
    try {
      const data = await this.request<T>(path, { ...requestOptions, idempotencyKey });
      return { state: 'completed', data };
    } catch (error) {
      if (!(error instanceof ApiNetworkError) || offlineQueue !== OUTBOX_OPERATION) throw error;
      // An authenticated action without an owner must never be persisted and
      // later replayed under a different Clerk session.
      if (!this.ownerId) throw error;
      const ownerNamespace = await apiOutbox.ownerNamespaceFor(this.ownerId);
      const item = await apiOutbox.enqueue({
        id: idempotencyKey,
        ownerNamespace,
        operation: OUTBOX_OPERATION,
        path,
        method: requestOptions.method,
        body: requestOptions.body,
        idempotencyKey,
      });
      return { state: 'queued', queueId: item.id };
    }
  }

  async flushOutbox(): Promise<{ sent: number; summary: OutboxSummary | null }> {
    if (!this.ownerId) return { sent: 0, summary: null };
    const ownerNamespace = await apiOutbox.ownerNamespaceFor(this.ownerId);
    const items = await apiOutbox.deliverable(ownerNamespace);
    let sent = 0;
    for (const item of items) {
      if (this.getCurrentOwnerId() !== this.ownerId) break;
      const delivery = await apiOutbox.beginDelivery(item.id, ownerNamespace);
      if (!delivery) continue;
      try {
        await this.request(delivery.path, {
          method: delivery.method,
          body: delivery.body,
          idempotencyKey: delivery.idempotencyKey,
          beforeAuthenticatedFetch: async () => {
            if (this.getCurrentOwnerId() !== this.ownerId) throw new ApiSessionChangedError();
            await apiOutbox.revalidateDelivery(delivery, ownerNamespace);
          },
        });
        await apiOutbox.removeDelivered(delivery.id, ownerNamespace);
        sent += 1;
      } catch (error) {
        if (error instanceof ApiSessionChangedError) break;
        if (error instanceof ApiNetworkError) {
          await apiOutbox.markNetworkFailure(delivery.id, ownerNamespace);
          break;
        }
        if (error instanceof ApiError) {
          if (classifyHttpDeliveryStatus(error.problem.status) === 'retryable') {
            await apiOutbox.markRetryableHttpFailure(delivery.id, ownerNamespace);
            break;
          }
          // Retain only an opaque terminal status for explicit reconciliation.
          // The server detail and response body never enter local storage.
          await apiOutbox.markServerRejected(delivery.id, ownerNamespace, error.problem.status);
          continue;
        }
        if (error instanceof OutboxValidationError) continue;
        throw error;
      }
    }
    return { sent, summary: await apiOutbox.summary(ownerNamespace) };
  }

  async outboxSummary(): Promise<OutboxSummary | null> {
    if (!this.ownerId) return null;
    return apiOutbox.summary(await apiOutbox.ownerNamespaceFor(this.ownerId));
  }
}
