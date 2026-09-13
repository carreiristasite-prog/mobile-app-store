import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  GcsPrivacyExportReader,
  loadPrivacyExportDeliveryConfig,
  parsePrivacyExportRange,
  validatePrivacyExportDescriptor,
  type PrivacyExportDeliveryConfig,
  type PrivacyExportDescriptor,
} from "./privacy-export-delivery.ts";

const bytes = new TextEncoder().encode('{"ok":true}');
const checksum = createHash("sha256").update(bytes).digest("hex");
const config: PrivacyExportDeliveryConfig = {
  bucket: "private-dsr-exports",
  kmsKeyResource: "projects/ia-aprova-prod/locations/southamerica-east1/keyRings/app/cryptoKeys/storage",
  objectPrefix: "dsr/exports/",
  maxBytes: 1024,
  maxRangeBytes: 1024,
  timeoutMs: 5_000,
};
const descriptor: PrivacyExportDescriptor = {
  requestId: "30000000-0000-4000-8000-000000000003",
  objectKey: `dsr/exports/30000000-0000-4000-8000-000000000003/${checksum}.json`,
  generation: "42",
  checksumSha256: checksum,
  sizeBytes: bytes.byteLength,
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
};

test("delivery config fails closed unless bucket, prefix, CMEK and lifecycle are explicit", () => {
  assert.equal(loadPrivacyExportDeliveryConfig({}), null);
  assert.throws(() => loadPrivacyExportDeliveryConfig({ PRIVACY_EXPORT_DELIVERY_ENABLED: "true" }), /allowlisted/);
  assert.throws(() => loadPrivacyExportDeliveryConfig({
    PRIVACY_EXPORT_DELIVERY_ENABLED: "true", PRIVACY_EXPORT_BUCKET: "private-dsr-exports",
    PRIVACY_EXPORT_BUCKET_ALLOWLIST: "private-dsr-exports", PRIVACY_EXPORT_OBJECT_PREFIX: "other/",
    PRIVACY_EXPORT_KMS_KEY_RESOURCE: config.kmsKeyResource,
    PRIVACY_EXPORT_CMEK_CONFIRMED: "true", PRIVACY_EXPORT_LIFECYCLE_CONFIRMED: "true",
  }), /OBJECT_PREFIX/);
});

test("descriptor cannot escape its request/checksum prefix or exceed size", () => {
  assert.doesNotThrow(() => validatePrivacyExportDescriptor(descriptor, config, new Date("2029-01-01T00:00:00Z")));
  assert.throws(() => validatePrivacyExportDescriptor({ ...descriptor, objectKey: "dsr/exports/../secret" }, config), /descriptor_rejected/);
  assert.throws(() => validatePrivacyExportDescriptor({ ...descriptor, generation: "latest" }, config), /descriptor_rejected/);
  assert.throws(() => validatePrivacyExportDescriptor({ ...descriptor, sizeBytes: 1025 }, config), /size_rejected/);
  assert.throws(() => validatePrivacyExportDescriptor({ ...descriptor, expiresAt: new Date(0) }, config), /expired/);
});

test("range parser accepts one bounded explicit range and rejects suffix/multipart/oversize", () => {
  assert.deepEqual(parsePrivacyExportRange("bytes=2-5", 11, 8), { start: 2, end: 5 });
  assert.deepEqual(parsePrivacyExportRange("bytes=3-", 11, 8), { start: 3, end: 10 });
  assert.throws(() => parsePrivacyExportRange("bytes=-4", 11, 8), /range_invalid/);
  assert.throws(() => parsePrivacyExportRange("bytes=0-1,3-4", 11, 8), /range_invalid/);
  assert.throws(() => parsePrivacyExportRange("bytes=0-9", 11, 8), /range_invalid/);
  assert.throws(() => parsePrivacyExportRange(undefined, 11, 8), /range_required/);
});

test("reader pins generation, verifies private metadata and checksum before returning", async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString(); calls.push(url);
    if (url.startsWith("http://metadata.google.internal/")) {
      assert.equal(new Headers(init?.headers).get("Metadata-Flavor"), "Google");
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    if (!url.includes("alt=media")) return Response.json({
      name: descriptor.objectKey, generation: descriptor.generation, size: String(bytes.byteLength),
      kmsKeyName: config.kmsKeyResource,
      customTime: descriptor.expiresAt.toISOString(),
      cacheControl: "private, no-store, max-age=0",
      metadata: { checksumSha256: checksum, expiresAt: descriptor.expiresAt.toISOString() },
    });
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
  };
  const result = await new GcsPrivacyExportReader(config, fetcher)
    .download(descriptor, undefined, new AbortController().signal);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.partial, false);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].includes("generation=42"));
  assert.ok(calls[2].includes("generation=42"));
});

test("reader rejects object metadata mismatch before media request", async () => {
  let calls = 0;
  const reader = new GcsPrivacyExportReader(config, async (input) => {
    calls += 1;
    if (input.toString().startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    return Response.json({ name: descriptor.objectKey, generation: "43", size: String(bytes.byteLength) });
  });
  await assert.rejects(reader.download(descriptor, undefined, new AbortController().signal), /metadata_mismatch/);
  assert.equal(calls, 2);
});

test("reader accepts equivalent RFC3339 timestamps and a version of the pinned CMEK", async () => {
  const reader = new GcsPrivacyExportReader(config, async (input) => {
    const url = input.toString();
    if (url.startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    if (!url.includes("alt=media")) return Response.json({
      name: descriptor.objectKey,
      generation: descriptor.generation,
      size: String(bytes.byteLength),
      kmsKeyName: `${config.kmsKeyResource}/cryptoKeyVersions/7`,
      customTime: "2030-01-01T00:00:00Z",
      cacheControl: "private, no-store, max-age=0",
      metadata: { checksumSha256: checksum, expiresAt: "2030-01-01T00:00:00Z" },
    });
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
  });
  await assert.doesNotReject(reader.download(descriptor, undefined, new AbortController().signal));
});

test("reader requires the exact upstream Content-Range for partial delivery", async () => {
  const reader = new GcsPrivacyExportReader({ ...config, maxRangeBytes: 8 }, async (input) => {
    const url = input.toString();
    if (url.startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    if (!url.includes("alt=media")) return Response.json({
      name: descriptor.objectKey, generation: descriptor.generation, size: String(bytes.byteLength),
      kmsKeyName: config.kmsKeyResource,
      customTime: descriptor.expiresAt.toISOString(), cacheControl: "private, no-store, max-age=0",
      metadata: { checksumSha256: checksum, expiresAt: descriptor.expiresAt.toISOString() },
    });
    return new Response(bytes.slice(0, 4), {
      status: 206,
      headers: { "content-length": "4", "content-range": `bytes 1-4/${bytes.byteLength}` },
    });
  });
  await assert.rejects(reader.download(descriptor, "bytes=0-3", new AbortController().signal), /content_range_mismatch/);
});

test("reader cancels a body that exceeds the authenticated descriptor length", async () => {
  const oversized = new Uint8Array(bytes.byteLength + 1);
  oversized.set(bytes);
  const reader = new GcsPrivacyExportReader(config, async (input) => {
    const url = input.toString();
    if (url.startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    if (!url.includes("alt=media")) return Response.json({
      name: descriptor.objectKey, generation: descriptor.generation, size: String(bytes.byteLength),
      kmsKeyName: config.kmsKeyResource,
      customTime: descriptor.expiresAt.toISOString(), cacheControl: "private, no-store, max-age=0",
      metadata: { checksumSha256: checksum, expiresAt: descriptor.expiresAt.toISOString() },
    });
    return new Response(oversized, {
      status: 200,
      headers: { "content-length": String(bytes.byteLength) },
    });
  });
  await assert.rejects(
    reader.download(descriptor, undefined, new AbortController().signal),
    /body_size_mismatch/,
  );
});
