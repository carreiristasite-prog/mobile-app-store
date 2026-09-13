import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PrivacyConfig } from "../config.ts";
import {
  canonicalJson,
  ClerkRevenueCatPrivacyProviders,
  GcsPrivateObjectStorage,
  PrivacyProcessingService,
} from "./privacy.ts";
import type { ExternalPrivacyProviders, PrivateObjectStorage, WorkerRepository } from "../types.ts";

const requestId = "30000000-0000-4000-8000-000000000003";
const userId = "20000000-0000-4000-8000-000000000002";
const requestedAt = new Date("2026-08-20T12:00:00.000Z");

const privacyConfig: PrivacyConfig = {
  exportBucket: "private-dsr-bucket",
  exportKmsKeyResource: "projects/ia-aprova-prod/locations/southamerica-east1/keyRings/app/cryptoKeys/storage",
  exportTtlHours: 24,
  timeoutMs: 5_000,
  retentionPolicyId: "privacy-policy-2026-08",
  retentionPolicySha256: "a".repeat(64),
  retentionApprovedAt: new Date("2026-08-20T00:00:00.000Z"),
  retentionApprovedBy: "external-reference",
  retentionRules: {
    version: 1,
    auditLogsDays: 365,
    riskEventsDays: 365,
    subscriptionEventsDays: 365,
    dataRequestsDays: 365,
    backupSuppressionDays: 30,
  },
  clerkSecretKey: "sk_test_1234567890abcdefghij",
};

function repository(overrides: Partial<WorkerRepository> = {}): WorkerRepository {
  return {
    claimBatch: async () => [], extendLease: async () => true, markProcessed: async () => true,
    reschedule: async () => true, deadLetter: async () => true, deadLetterCount: async () => 0,
    ping: async () => undefined, scheduleDailyBillingReconciliation: async () => 0,
    reconcileProEntitlement: async () => false,
    completeBillingReconciliationItem: async () => undefined,
    failBillingReconciliationItem: async () => undefined,
    finalizeSimulationDeadline: async () => ({ status: "missing" }),
    getDataRequest: async () => null,
    startDataRequest: async ({ kind }) => ({ id: requestId, userId, kind, status: "processing", phase: "requested", requestedAt }),
    buildUserExportSnapshot: async () => ({
      schemaVersion: 1, subjectId: userId, requestedAt: requestedAt.toISOString(),
      datasets: { profile: [{ z: 2, a: 1 }] },
    }),
    recordDataRequestStep: async () => undefined,
    listUserExportObjects: async () => [],
    recordExportObjectsRevoked: async () => undefined,
    revokeUserAccess: async () => ({ clerkSubject: "user_clerk", revenueCatCustomerId: "user_clerk" }),
    eraseUserData: async () => undefined,
    completeDataRequest: async () => true,
    ...overrides,
  };
}

test("canonical manifest sorts object keys recursively and rejects non-finite values", () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 4, b: 2 }, list: [{ y: true, x: false }] }),
    '{"a":{"b":2,"d":4},"list":[{"x":false,"y":true}],"z":1}');
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non_finite/);
});

test("GCS adapter uses workload identity, private upload and no public URL", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const bytes = new TextEncoder().encode("{}");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const expiresAt = new Date(Date.now() + 60_000);
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    calls.push({ url, init });
    if (url.startsWith("http://metadata.google.internal/")) {
      assert.equal(new Headers(init?.headers).get("Metadata-Flavor"), "Google");
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    return Response.json({
      name: `dsr/exports/${requestId}/${createHash("sha256").update("{}").digest("hex")}.json`,
      generation: "42",
      size: "2",
      kmsKeyName: `${privacyConfig.exportKmsKeyResource}/cryptoKeyVersions/7`,
      customTime: expiresAt.toISOString(),
      cacheControl: "private, no-store, max-age=0",
      metadata: { checksumSha256, expiresAt: expiresAt.toISOString() },
    }, { status: 200 });
  };
  const storage = new GcsPrivateObjectStorage(privacyConfig, fetcher);
  const stored = await storage.putPrivateObject({
    objectKey: `dsr/exports/${requestId}/${checksumSha256}.json`, bytes, checksumSha256,
    expiresAt, signal: new AbortController().signal,
  });
  assert.equal(stored.generation, "42");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /^https:\/\/storage\.googleapis\.com\/upload\/storage\/v1\/b\/private-dsr-bucket\/o\?/);
  assert.equal(new Headers(calls[1].init?.headers).get("cache-control"), "private, no-store, max-age=0");
  assert.equal(calls[1].url.includes("storage.cloud.google.com"), false);
});

test("GCS adapter rejects mismatched content before requesting a token", async () => {
  let calls = 0;
  const storage = new GcsPrivateObjectStorage(privacyConfig, async () => {
    calls += 1;
    throw new Error("must not fetch");
  });
  const bytes = new TextEncoder().encode("{}");
  await assert.rejects(storage.putPrivateObject({
    objectKey: `dsr/exports/${requestId}/${"a".repeat(64)}.json`,
    bytes,
    checksumSha256: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    signal: new AbortController().signal,
  }), /checksum_rejected/);
  assert.equal(calls, 0);
});

test("GCS deletion pins a validated generation and treats missing object as idempotent", async () => {
  const calls: { url: string; method?: string }[] = [];
  const storage = new GcsPrivateObjectStorage(privacyConfig, async (input, init) => {
    const url = input.toString(); calls.push({ url, method: init?.method });
    if (url.startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    return new Response(null, { status: 404 });
  });
  const objectKey = `dsr/exports/${requestId}/${"a".repeat(64)}.json`;
  await storage.deletePrivateObject({ objectKey, generation: "42", signal: new AbortController().signal });
  assert.equal(calls[1].method, "DELETE");
  assert.match(calls[1].url, /generation=42/);
  await assert.rejects(storage.deletePrivateObject({
    objectKey: "dsr/exports/../other", generation: "42", signal: new AbortController().signal,
  }), /descriptor_rejected/);
});

test("GCS collision verification rejects an oversized media body without unbounded buffering", async () => {
  const expected = new TextEncoder().encode("{}");
  const checksumSha256 = createHash("sha256").update(expected).digest("hex");
  const expiresAt = new Date(Math.ceil((Date.now() + 60_000) / 1_000) * 1_000);
  const storage = new GcsPrivateObjectStorage(privacyConfig, async (input) => {
    const url = input.toString();
    if (url.startsWith("http://metadata.google.internal/")) {
      return Response.json({ access_token: "token_12345678901234567890", expires_in: 300 });
    }
    if (url.includes("uploadType=multipart")) return new Response(null, { status: 412 });
    if (!url.includes("alt=media")) return Response.json({
      name: `dsr/exports/${requestId}/${checksumSha256}.json`,
      generation: "42",
      size: String(expected.byteLength),
      kmsKeyName: `${privacyConfig.exportKmsKeyResource}/cryptoKeyVersions/7`,
      customTime: expiresAt.toISOString().replace(".000Z", "Z"),
      cacheControl: "private, no-store, max-age=0",
      metadata: { checksumSha256, expiresAt: expiresAt.toISOString().replace(".000Z", "Z") },
    });
    return new Response(new Uint8Array(expected.byteLength + 1));
  });
  await assert.rejects(storage.putPrivateObject({
    objectKey: `dsr/exports/${requestId}/${checksumSha256}.json`,
    bytes: expected,
    checksumSha256,
    expiresAt,
    signal: new AbortController().signal,
  }), /body_mismatch/);
});

test("provider deletion accepts idempotent 404 but stops before RevenueCat on Clerk failure", async () => {
  const urls: string[] = [];
  const okProviders = new ClerkRevenueCatPrivacyProviders(privacyConfig, {
    secretApiKey: "sk_1234567890abcdef", projectId: "proj123", environment: "sandbox", timeoutMs: 5_000,
  }, async (input) => { urls.push(input.toString()); return new Response(null, { status: 404 }); });
  await okProviders.eraseAccounts({ clerkSubject: "user_clerk", revenueCatCustomerId: "user_clerk", signal: new AbortController().signal });
  assert.equal(urls.length, 2);

  let calls = 0;
  const failing = new ClerkRevenueCatPrivacyProviders(privacyConfig, {
    secretApiKey: "sk_1234567890abcdef", projectId: "proj123", environment: "sandbox", timeoutMs: 5_000,
  }, async () => { calls += 1; return new Response(null, { status: 503 }); });
  await assert.rejects(failing.eraseAccounts({ clerkSubject: "user_clerk", revenueCatCustomerId: "user_clerk", signal: new AbortController().signal }));
  assert.equal(calls, 1);
});

test("export records private-object evidence only after storage succeeds", async () => {
  const calls: string[] = [];
  const repo = repository({
    recordDataRequestStep: async (input) => { calls.push(`record:${input.step}:${input.exportMetadata?.objectKey}`); },
  });
  const storage: PrivateObjectStorage = {
    putPrivateObject: async (input) => { calls.push(`store:${input.objectKey}`); return { objectKey: input.objectKey, generation: "7" }; },
    deletePrivateObject: async () => undefined,
  };
  const providers: ExternalPrivacyProviders = { eraseAccounts: async () => undefined };
  const service = new PrivacyProcessingService(repo, storage, providers, privacyConfig);
  await service.exportUserData({ requestId, userId, signal: new AbortController().signal });
  assert.match(calls[0], /^store:dsr\/exports\//);
  assert.match(calls[1], /^record:export_stored:dsr\/exports\//);
});

test("deletion never erases internal data when an external provider fails", async () => {
  let erased = 0;
  const repo = repository({ eraseUserData: async () => { erased += 1; } });
  const storage: PrivateObjectStorage = {
    putPrivateObject: async () => { throw new Error("unused"); },
    deletePrivateObject: async () => undefined,
  };
  const providers: ExternalPrivacyProviders = { eraseAccounts: async () => { throw new Error("provider_down"); } };
  const service = new PrivacyProcessingService(repo, storage, providers, privacyConfig);
  await assert.rejects(service.deleteUserData({ requestId, userId, signal: new AbortController().signal }), /provider_down/);
  assert.equal(erased, 0);
});

test("deletion removes every pinned export before revoking access or external accounts", async () => {
  const calls: string[] = [];
  const objects = [{
    requestId: "40000000-0000-4000-8000-000000000004",
    objectKey: `dsr/exports/40000000-0000-4000-8000-000000000004/${"b".repeat(64)}.json`,
    generation: "71",
    checksumSha256: "b".repeat(64),
  }];
  const repo = repository({
    listUserExportObjects: async () => objects,
    recordExportObjectsRevoked: async ({ objects: received }) => { assert.deepEqual(received, objects); calls.push("record-revoked"); },
    revokeUserAccess: async () => { calls.push("revoke-access"); return { clerkSubject: "user_clerk", revenueCatCustomerId: "user_clerk" }; },
    eraseUserData: async () => { calls.push("erase-internal"); },
  });
  const storage: PrivateObjectStorage = {
    putPrivateObject: async () => { throw new Error("unused"); },
    deletePrivateObject: async (input) => { calls.push(`delete:${input.generation}`); },
  };
  const providers: ExternalPrivacyProviders = { eraseAccounts: async () => { calls.push("erase-external"); } };
  await new PrivacyProcessingService(repo, storage, providers, privacyConfig)
    .deleteUserData({ requestId, userId, signal: new AbortController().signal });
  assert.deepEqual(calls, ["delete:71", "record-revoked", "revoke-access", "erase-external", "erase-internal"]);
});

test("deletion fails closed before access revocation when private object deletion fails", async () => {
  let revoked = false;
  const repo = repository({
    listUserExportObjects: async () => [{
      requestId: "40000000-0000-4000-8000-000000000004",
      objectKey: `dsr/exports/40000000-0000-4000-8000-000000000004/${"b".repeat(64)}.json`,
      generation: "71", checksumSha256: "b".repeat(64),
    }],
    revokeUserAccess: async () => { revoked = true; throw new Error("must-not-run"); },
  });
  const storage: PrivateObjectStorage = {
    putPrivateObject: async () => { throw new Error("unused"); },
    deletePrivateObject: async () => { throw new Error("gcs_down"); },
  };
  await assert.rejects(new PrivacyProcessingService(repo, storage, { eraseAccounts: async () => undefined }, privacyConfig)
    .deleteUserData({ requestId, userId, signal: new AbortController().signal }), /gcs_down/);
  assert.equal(revoked, false);
});
