import { createHash } from "node:crypto";

const GCS_JSON_ORIGIN = "https://storage.googleapis.com";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
export const MAX_PRIVACY_EXPORT_BYTES = 50 * 1024 * 1024;
export const MAX_PRIVACY_EXPORT_RANGE_BYTES = 8 * 1024 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PrivacyExportDeliveryConfig {
  bucket: string;
  kmsKeyResource: string;
  objectPrefix: "dsr/exports/";
  maxBytes: number;
  maxRangeBytes: number;
  timeoutMs: number;
}

export interface PrivacyExportDescriptor {
  requestId: string;
  objectKey: string;
  generation: string;
  checksumSha256: string;
  sizeBytes: number;
  expiresAt: Date;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface PrivacyExportDownload {
  bytes: Uint8Array;
  range: ByteRange;
  partial: boolean;
}

export class PrivacyExportDeliveryError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

function exactBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  if (value === "true") return true;
  if (value === "false" || value === undefined || value === "") return false;
  throw new Error(`${name} must be true or false`);
}

function boundedInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

export function loadPrivacyExportDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): PrivacyExportDeliveryConfig | null {
  const enabled = exactBoolean(env, "PRIVACY_EXPORT_DELIVERY_ENABLED");
  if (!enabled) return null;
  const bucket = env["PRIVACY_EXPORT_BUCKET"] ?? "";
  const allowlist = new Set((env["PRIVACY_EXPORT_BUCKET_ALLOWLIST"] ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  const prefix = env["PRIVACY_EXPORT_OBJECT_PREFIX"] ?? "";
  const kmsKeyResource = env["PRIVACY_EXPORT_KMS_KEY_RESOURCE"] ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) || !allowlist.has(bucket)) {
    throw new Error("PRIVACY_EXPORT_BUCKET must be valid and explicitly allowlisted");
  }
  if (prefix !== "dsr/exports/") {
    throw new Error("PRIVACY_EXPORT_OBJECT_PREFIX must be dsr/exports/");
  }
  if (!/^projects\/[a-z0-9-]+\/locations\/southamerica-east1\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/.test(kmsKeyResource)) {
    throw new Error("PRIVACY_EXPORT_KMS_KEY_RESOURCE is invalid");
  }
  if (!exactBoolean(env, "PRIVACY_EXPORT_CMEK_CONFIRMED")
      || !exactBoolean(env, "PRIVACY_EXPORT_LIFECYCLE_CONFIRMED")) {
    throw new Error("Privacy export delivery requires confirmed CMEK and lifecycle configuration");
  }
  return {
    bucket,
    kmsKeyResource,
    objectPrefix: prefix,
    maxBytes: boundedInteger(env, "PRIVACY_EXPORT_MAX_BYTES", MAX_PRIVACY_EXPORT_BYTES, 1, MAX_PRIVACY_EXPORT_BYTES),
    maxRangeBytes: boundedInteger(env, "PRIVACY_EXPORT_MAX_RANGE_BYTES", MAX_PRIVACY_EXPORT_RANGE_BYTES, 1, MAX_PRIVACY_EXPORT_RANGE_BYTES),
    timeoutMs: boundedInteger(env, "PRIVACY_EXPORT_TIMEOUT_MS", 10_000, 500, 60_000),
  };
}

export function validatePrivacyExportDescriptor(
  descriptor: PrivacyExportDescriptor,
  config: PrivacyExportDeliveryConfig,
  now = new Date(),
): void {
  const expectedKey = `${config.objectPrefix}${descriptor.requestId}/${descriptor.checksumSha256}.json`;
  if (!/^[0-9a-f-]{36}$/.test(descriptor.requestId)
      || !/^[a-f0-9]{64}$/.test(descriptor.checksumSha256)
      || descriptor.objectKey !== expectedKey
      || !/^\d+$/.test(descriptor.generation)) {
    throw new PrivacyExportDeliveryError("privacy_export_descriptor_rejected");
  }
  if (!Number.isSafeInteger(descriptor.sizeBytes)
      || descriptor.sizeBytes < 1
      || descriptor.sizeBytes > config.maxBytes) {
    throw new PrivacyExportDeliveryError("privacy_export_size_rejected");
  }
  if (Number.isNaN(descriptor.expiresAt.getTime())) {
    throw new PrivacyExportDeliveryError("privacy_export_expiry_invalid");
  }
  if (descriptor.expiresAt.getTime() <= now.getTime()) {
    throw new PrivacyExportDeliveryError("privacy_export_expired");
  }
}

export function parsePrivacyExportRange(
  raw: string | undefined,
  totalSize: number,
  maxRangeBytes: number,
): ByteRange {
  if (!raw) {
    if (totalSize > maxRangeBytes) {
      throw new PrivacyExportDeliveryError("privacy_export_range_required");
    }
    return { start: 0, end: totalSize - 1 };
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(raw.trim());
  if (!match) throw new PrivacyExportDeliveryError("privacy_export_range_invalid");
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? Math.min(totalSize - 1, start + maxRangeBytes - 1) : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
      || start < 0 || start >= totalSize || requestedEnd < start || requestedEnd >= totalSize
      || requestedEnd - start + 1 > maxRangeBytes) {
    throw new PrivacyExportDeliveryError("privacy_export_range_invalid");
  }
  return { start, end: requestedEnd };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

async function readExactBody(response: Response, expectedLength: number): Promise<Uint8Array> {
  if (!response.body) {
    throw new PrivacyExportDeliveryError("privacy_export_body_size_mismatch", true);
  }
  const bytes = new Uint8Array(expectedLength);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > expectedLength - offset) {
        await reader.cancel("privacy_export_body_limit_exceeded").catch(() => undefined);
        throw new PrivacyExportDeliveryError("privacy_export_body_size_mismatch", true);
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } catch (error) {
    if (error instanceof PrivacyExportDeliveryError) throw error;
    throw new PrivacyExportDeliveryError("privacy_export_provider_network_error", true);
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedLength) {
    throw new PrivacyExportDeliveryError("privacy_export_body_size_mismatch", true);
  }
  return bytes;
}

export class GcsPrivacyExportReader {
  private readonly config: PrivacyExportDeliveryConfig;
  private readonly fetcher: FetchLike;

  constructor(
    config: PrivacyExportDeliveryConfig,
    fetcher: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async download(
    descriptor: PrivacyExportDescriptor,
    rawRange: string | undefined,
    signal: AbortSignal,
  ): Promise<PrivacyExportDownload> {
    validatePrivacyExportDescriptor(descriptor, this.config);
    const range = parsePrivacyExportRange(rawRange, descriptor.sizeBytes, this.config.maxRangeBytes);
    const token = await this.accessToken(signal);
    await this.verifyMetadata(descriptor, token, signal);
    const url = this.objectUrl(descriptor, true);
    const full = range.start === 0 && range.end === descriptor.sizeBytes - 1;
    const response = await this.request(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "cache-control": "no-store",
        ...(full ? {} : { range: `bytes=${range.start}-${range.end}` }),
      },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
    });
    if ((!full && response.status !== 206) || (full && response.status !== 200)) {
      throw this.upstreamError(response.status);
    }
    const expectedLength = range.end - range.start + 1;
    const contentLength = response.headers.get("content-length");
    if (contentLength === null || Number(contentLength) !== expectedLength) {
      throw new PrivacyExportDeliveryError("privacy_export_content_length_mismatch", true);
    }
    if (!full && response.headers.get("content-range") !== `bytes ${range.start}-${range.end}/${descriptor.sizeBytes}`) {
      throw new PrivacyExportDeliveryError("privacy_export_content_range_mismatch", true);
    }
    const bytes = await readExactBody(response, expectedLength);
    if (full && createHash("sha256").update(bytes).digest("hex") !== descriptor.checksumSha256) {
      throw new PrivacyExportDeliveryError("privacy_export_checksum_mismatch", true);
    }
    return { bytes, range, partial: !full };
  }

  private async verifyMetadata(
    descriptor: PrivacyExportDescriptor,
    token: string,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.request(this.objectUrl(descriptor, false), {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, "cache-control": "no-store" },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
    });
    if (!response.ok) throw this.upstreamError(response.status);
    const metadata = asRecord(await response.json().catch(() => null));
    const custom = asRecord(metadata?.["metadata"]);
    if (metadata?.["name"] !== descriptor.objectKey
        || metadata?.["generation"] !== descriptor.generation
        || metadata?.["size"] !== String(descriptor.sizeBytes)
        || !belongsToKmsKey(this.config.kmsKeyResource, metadata?.["kmsKeyName"])
        || !sameTimestamp(descriptor.expiresAt, metadata?.["customTime"])
        || custom?.["checksumSha256"] !== descriptor.checksumSha256
        || !sameTimestamp(descriptor.expiresAt, custom?.["expiresAt"])
        || metadata?.["cacheControl"] !== "private, no-store, max-age=0"
        || metadata?.["temporaryHold"] === true
        || metadata?.["eventBasedHold"] === true
        || metadata?.["retentionExpirationTime"] != null
        || metadata?.["retention"] != null) {
      throw new PrivacyExportDeliveryError("privacy_export_metadata_mismatch", true);
    }
  }

  private objectUrl(descriptor: PrivacyExportDescriptor, media: boolean): URL {
    const url = new URL(`${GCS_JSON_ORIGIN}/storage/v1/b/${encodeURIComponent(this.config.bucket)}/o/${encodeURIComponent(descriptor.objectKey)}`);
    url.searchParams.set("generation", descriptor.generation);
    if (media) url.searchParams.set("alt", "media");
    return url;
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    const response = await this.request(new URL(METADATA_TOKEN_URL), {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
    });
    if (!response.ok) throw new PrivacyExportDeliveryError("privacy_export_workload_identity_unavailable", true);
    const payload = asRecord(await response.json().catch(() => null));
    const token = payload?.["access_token"];
    const expiresIn = payload?.["expires_in"];
    if (typeof token !== "string" || token.length < 20 || typeof expiresIn !== "number" || expiresIn < 60) {
      throw new PrivacyExportDeliveryError("privacy_export_workload_identity_invalid", true);
    }
    return token;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new PrivacyExportDeliveryError("privacy_export_provider_network_error", true);
    }
  }

  private upstreamError(status: number): PrivacyExportDeliveryError {
    if (status === 404 || status === 410) return new PrivacyExportDeliveryError("privacy_export_object_unavailable");
    if (status === 401 || status === 403) return new PrivacyExportDeliveryError("privacy_export_provider_auth_rejected", true);
    if (status === 429 || status >= 500) return new PrivacyExportDeliveryError("privacy_export_provider_unavailable", true);
    return new PrivacyExportDeliveryError("privacy_export_provider_rejected", true);
  }
}
