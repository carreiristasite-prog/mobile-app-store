import { createHash } from "node:crypto";
import type { PrivacyConfig, RevenueCatConfig } from "../config.ts";
import { RetryableWorkerError } from "../errors.ts";
import type {
  ExternalPrivacyProviders,
  PrivateObjectStorage,
  PrivacyAdapter,
  WorkerRepository,
} from "../types.ts";

const GCS_ORIGIN = "https://storage.googleapis.com";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const CLERK_ORIGIN = "https://api.clerk.com";
const REVENUECAT_ORIGIN = "https://api.revenuecat.com";
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("privacy_manifest_non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("privacy_manifest_unsupported_value");
}

function combinedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function sameTimestamp(expected: Date, actual: unknown): boolean {
  if (typeof actual !== "string") return false;
  const parsed = new Date(actual);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() === expected.getTime();
}

function belongsToKmsKey(expectedKey: string, actual: unknown): boolean {
  return actual === expectedKey
    || (typeof actual === "string"
      && new RegExp(`^${expectedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cryptoKeyVersions/[1-9][0-9]*$`).test(actual));
}

async function readExactPrivateObject(response: Response, expectedLength: number): Promise<Uint8Array> {
  if (!response.body) throw new RetryableWorkerError("gcs_existing_object_body_mismatch");
  const bytes = new Uint8Array(expectedLength);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > expectedLength - offset) {
        await reader.cancel("gcs_existing_object_body_limit_exceeded").catch(() => undefined);
        throw new RetryableWorkerError("gcs_existing_object_body_mismatch");
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } catch (error) {
    if (error instanceof RetryableWorkerError) throw error;
    throw new RetryableWorkerError("privacy_provider_network_error");
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedLength) throw new RetryableWorkerError("gcs_existing_object_body_mismatch");
  return bytes;
}

export class GcsPrivateObjectStorage implements PrivateObjectStorage {
  private readonly config: Pick<PrivacyConfig, "exportBucket" | "exportKmsKeyResource" | "timeoutMs">;
  private readonly fetcher: FetchLike;

  constructor(
    config: Pick<PrivacyConfig, "exportBucket" | "exportKmsKeyResource" | "timeoutMs">,
    fetcher: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async putPrivateObject(input: Parameters<PrivateObjectStorage["putPrivateObject"]>[0]): Promise<{ objectKey: string; generation: string }> {
    if (!/^dsr\/exports\/[0-9a-f-]{36}\/[a-f0-9]{64}\.json$/.test(input.objectKey)) {
      throw new Error("privacy_object_key_rejected");
    }
    if (input.bytes.byteLength > MAX_EXPORT_BYTES
        || createHash("sha256").update(input.bytes).digest("hex") !== input.checksumSha256) {
      throw new Error("privacy_object_checksum_rejected");
    }
    if (Number.isNaN(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) {
      throw new Error("privacy_object_expiry_rejected");
    }
    const token = await this.accessToken(input.signal);
    const url = new URL(`${GCS_ORIGIN}/upload/storage/v1/b/${encodeURIComponent(this.config.exportBucket)}/o`);
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("ifGenerationMatch", "0");
    const boundary = `ia-aprova-${input.checksumSha256}`;
    const metadata = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
        name: input.objectKey,
        cacheControl: "private, no-store, max-age=0",
        customTime: input.expiresAt.toISOString(),
        metadata: { expiresAt: input.expiresAt.toISOString(), checksumSha256: input.checksumSha256 },
      })}\r\n--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`,
      "utf8",
    );
    const body = Buffer.concat([metadata, Buffer.from(input.bytes), Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")]);
    const response = await this.request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "cache-control": "private, no-store, max-age=0",
      },
      body,
      signal: combinedSignal(input.signal, this.config.timeoutMs),
      redirect: "error",
    });
    if (response.status === 412) {
      const generation = await this.verifyExisting(input, token);
      return { objectKey: input.objectKey, generation };
    }
    if (!response.ok) throw this.upstreamError("gcs", response.status);
    const responseMetadata = plainObject(await response.json().catch(() => null));
    const generation = this.validateStoredMetadata(responseMetadata, input, "gcs_response_invalid");
    return { objectKey: input.objectKey, generation };
  }

  async deletePrivateObject(input: Parameters<PrivateObjectStorage["deletePrivateObject"]>[0]): Promise<void> {
    if (!/^dsr\/exports\/[0-9a-f-]{36}\/[a-f0-9]{64}\.json$/.test(input.objectKey)
        || !/^\d+$/.test(input.generation)) {
      throw new Error("privacy_object_delete_descriptor_rejected");
    }
    const token = await this.accessToken(input.signal);
    const url = new URL(`${GCS_ORIGIN}/storage/v1/b/${encodeURIComponent(this.config.exportBucket)}/o/${encodeURIComponent(input.objectKey)}`);
    url.searchParams.set("generation", input.generation);
    const response = await this.request(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "cache-control": "no-store" },
      signal: combinedSignal(input.signal, this.config.timeoutMs),
      redirect: "error",
    });
    if (response.ok || response.status === 404) return;
    throw this.upstreamError("gcs", response.status);
  }

  private async verifyExisting(
    input: Parameters<PrivateObjectStorage["putPrivateObject"]>[0],
    token: string,
  ): Promise<string> {
    const metadataUrl = new URL(`${GCS_ORIGIN}/storage/v1/b/${encodeURIComponent(this.config.exportBucket)}/o/${encodeURIComponent(input.objectKey)}`);
    const metadataResponse = await this.request(metadataUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, "cache-control": "no-store" },
      signal: combinedSignal(input.signal, this.config.timeoutMs),
      redirect: "error",
    });
    if (!metadataResponse.ok) throw this.upstreamError("gcs", metadataResponse.status);
    const metadata = plainObject(await metadataResponse.json().catch(() => null));
    const generation = this.validateStoredMetadata(metadata, input, "gcs_existing_object_metadata_mismatch");
    const url = new URL(`${GCS_ORIGIN}/storage/v1/b/${encodeURIComponent(this.config.exportBucket)}/o/${encodeURIComponent(input.objectKey)}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("generation", generation);
    const response = await this.request(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, "cache-control": "no-store" },
      signal: combinedSignal(input.signal, this.config.timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw this.upstreamError("gcs", response.status);
    const bytes = await readExactPrivateObject(response, input.bytes.byteLength);
    if (createHash("sha256").update(bytes).digest("hex") !== input.checksumSha256) {
      throw new RetryableWorkerError("gcs_existing_object_mismatch");
    }
    return generation;
  }

  private validateStoredMetadata(
    metadata: Record<string, unknown> | null,
    input: Parameters<PrivateObjectStorage["putPrivateObject"]>[0],
    errorCode: string,
  ): string {
    const custom = plainObject(metadata?.["metadata"]);
    const generation = metadata?.["generation"];
    if (metadata?.["name"] !== input.objectKey || typeof generation !== "string" || !/^\d+$/.test(generation)
        || metadata?.["size"] !== String(input.bytes.byteLength)
        || !belongsToKmsKey(this.config.exportKmsKeyResource, metadata?.["kmsKeyName"])
        || !sameTimestamp(input.expiresAt, metadata?.["customTime"])
        || metadata?.["cacheControl"] !== "private, no-store, max-age=0"
        || custom?.["checksumSha256"] !== input.checksumSha256
        || !sameTimestamp(input.expiresAt, custom?.["expiresAt"])
        || metadata?.["temporaryHold"] === true
        || metadata?.["eventBasedHold"] === true
        || metadata?.["retentionExpirationTime"] != null
        || metadata?.["retention"] != null) {
      throw new RetryableWorkerError(errorCode);
    }
    return generation;
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    const response = await this.request(new URL(METADATA_TOKEN_URL), {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      signal: combinedSignal(signal, this.config.timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw new RetryableWorkerError("gcs_workload_identity_unavailable");
    const data = plainObject(await response.json().catch(() => null));
    const token = data?.["access_token"];
    const expiresIn = data?.["expires_in"];
    if (typeof token !== "string" || token.length < 20 || typeof expiresIn !== "number" || expiresIn < 60) {
      throw new RetryableWorkerError("gcs_workload_identity_invalid");
    }
    return token;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    try { return await this.fetcher(url, init); } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new RetryableWorkerError("privacy_provider_network_error");
    }
  }

  private upstreamError(provider: string, status: number): RetryableWorkerError {
    if (status === 401 || status === 403) return new RetryableWorkerError(`${provider}_auth_rejected`);
    if (status === 429) return new RetryableWorkerError(`${provider}_rate_limited`);
    return new RetryableWorkerError(`${provider}_upstream_error`);
  }
}

export class ClerkRevenueCatPrivacyProviders implements ExternalPrivacyProviders {
  private readonly privacy: Pick<PrivacyConfig, "clerkSecretKey" | "timeoutMs">;
  private readonly revenueCat: RevenueCatConfig;
  private readonly fetcher: FetchLike;

  constructor(
    privacy: Pick<PrivacyConfig, "clerkSecretKey" | "timeoutMs">,
    revenueCat: RevenueCatConfig,
    fetcher: FetchLike = fetch,
  ) {
    this.privacy = privacy;
    this.revenueCat = revenueCat;
    this.fetcher = fetcher;
  }

  async eraseAccounts(input: Parameters<ExternalPrivacyProviders["eraseAccounts"]>[0]): Promise<void> {
    await this.erase(
      new URL(`${CLERK_ORIGIN}/v1/users/${encodeURIComponent(input.clerkSubject)}`),
      this.privacy.clerkSecretKey,
      input.signal,
      "clerk",
    );
    await this.erase(
      new URL(`${REVENUECAT_ORIGIN}/v2/projects/${encodeURIComponent(this.revenueCat.projectId)}/customers/${encodeURIComponent(input.revenueCatCustomerId)}`),
      this.revenueCat.secretApiKey,
      input.signal,
      "revenuecat",
    );
  }

  private async erase(url: URL, key: string, signal: AbortSignal, provider: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "DELETE",
        headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "ia-aprova-worker/0.0.0" },
        redirect: "error",
        signal: combinedSignal(signal, this.privacy.timeoutMs),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new RetryableWorkerError(`${provider}_privacy_network_error`);
    }
    if (response.ok || response.status === 404) return;
    if (response.status === 401 || response.status === 403) throw new RetryableWorkerError(`${provider}_privacy_auth_rejected`);
    if (response.status === 409 || response.status === 429 || response.status >= 500) {
      throw new RetryableWorkerError(`${provider}_privacy_retryable`);
    }
    throw new RetryableWorkerError(`${provider}_privacy_rejected`);
  }
}

export class PrivacyProcessingService implements PrivacyAdapter {
  private readonly repository: WorkerRepository;
  private readonly storage: PrivateObjectStorage;
  private readonly providers: ExternalPrivacyProviders;
  private readonly config: PrivacyConfig;

  constructor(
    repository: WorkerRepository,
    storage: PrivateObjectStorage,
    providers: ExternalPrivacyProviders,
    config: PrivacyConfig,
  ) {
    this.repository = repository;
    this.storage = storage;
    this.providers = providers;
    this.config = config;
  }

  async exportUserData(input: Parameters<PrivacyAdapter["exportUserData"]>[0]): Promise<void> {
    const request = await this.repository.startDataRequest({ ...input, kind: "export" });
    if (!request) throw new RetryableWorkerError("privacy_export_state_unavailable");
    if (request.status === "completed") return;
    const snapshot = await this.repository.buildUserExportSnapshot(input);
    const bytes = Buffer.from(canonicalJson(snapshot), "utf8");
    if (bytes.byteLength > MAX_EXPORT_BYTES) throw new RetryableWorkerError("privacy_export_too_large");
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `dsr/exports/${input.requestId}/${checksumSha256}.json`;
    const expiresAt = new Date(request.requestedAt.getTime() + this.config.exportTtlHours * 3_600_000);
    const stored = await this.storage.putPrivateObject({
      objectKey, bytes, checksumSha256, expiresAt, signal: input.signal,
    });
    const counts = Object.fromEntries(Object.entries(snapshot.datasets).map(([name, rows]) => [name, rows.length]));
    await this.repository.recordDataRequestStep({
      requestId: input.requestId,
      userId: input.userId,
      step: "export_stored",
      phase: "export_stored",
      idempotencyKey: `export-stored:${input.requestId}:${checksumSha256}`,
      evidence: { schemaVersion: 1, checksumSha256, generation: stored.generation, datasetCounts: counts },
      exportMetadata: { checksumSha256, sizeBytes: bytes.byteLength, objectKey: stored.objectKey, generation: stored.generation, expiresAt },
    });
  }

  async deleteUserData(input: Parameters<PrivacyAdapter["deleteUserData"]>[0]): Promise<void> {
    const request = await this.repository.startDataRequest({ ...input, kind: "deletion" });
    if (!request) throw new RetryableWorkerError("privacy_deletion_state_unavailable");
    if (request.status === "completed") return;
    if (request.phase === "internal_data_erased") return;
    const exportObjects = await this.repository.listUserExportObjects({ userId: input.userId });
    for (const object of exportObjects) {
      await this.storage.deletePrivateObject({
        objectKey: object.objectKey,
        generation: object.generation,
        signal: input.signal,
      });
    }
    await this.repository.recordExportObjectsRevoked({
      deletionRequestId: input.requestId,
      userId: input.userId,
      objects: exportObjects,
    });
    const subjects = await this.repository.revokeUserAccess(input);
    if (request.phase !== "external_accounts_erased") {
      await this.providers.eraseAccounts({ ...subjects, signal: input.signal });
      await this.repository.recordDataRequestStep({
        requestId: input.requestId,
        userId: input.userId,
        step: "external_accounts_erased",
        phase: "external_accounts_erased",
        idempotencyKey: `external-erased:${input.requestId}`,
        evidence: { clerk: true, revenueCat: true },
        retentionPolicy: { id: this.config.retentionPolicyId, sha256: this.config.retentionPolicySha256 },
      });
    }
    await this.repository.eraseUserData({
      requestId: input.requestId,
      userId: input.userId,
      retentionPolicy: { id: this.config.retentionPolicyId, sha256: this.config.retentionPolicySha256 },
    });
  }
}
