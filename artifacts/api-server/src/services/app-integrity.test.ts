import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT } from "@workspace/age-integrity";
import {
  CreateIntegrityChallengeRequestSchema,
  IntegrityVerificationResponseSchema,
  VerifiedPlatformAgeSignalEnvelopeSchema,
} from "../../../../lib/api-zod/src/contracts.ts";
import {
  APP_INTEGRITY_PHASE_A_POLICY_VERSION,
  PHASE_A_PROVIDER_ADAPTERS,
  canonicalEnvelope,
  deriveAuthSessionHash,
  derivePrincipalBinding,
  integrityEnvelopeDigest,
  loadAppIntegrityConfig,
  sha256Hex,
} from "./app-integrity.ts";

const key = Buffer.alloc(32, 7).toString("base64url");

function config() {
  return loadAppIntegrityConfig({
    INTEGRITY_ENVIRONMENT: "development",
    INTEGRITY_PRINCIPAL_BINDING_CURRENT_VERSION: "pbk-test-1",
    INTEGRITY_PRINCIPAL_BINDING_KEYS_JSON: JSON.stringify({ "pbk-test-1": key }),
  });
}

test("configuração falha fechada quando ambiente, versão ou chave não existem", () => {
  assert.throws(() => loadAppIntegrityConfig({}), /config_missing/);
  assert.throws(() => loadAppIntegrityConfig({
    INTEGRITY_ENVIRONMENT: "production",
    INTEGRITY_PRINCIPAL_BINDING_CURRENT_VERSION: "pbk-test-2",
    INTEGRITY_PRINCIPAL_BINDING_KEYS_JSON: JSON.stringify({ "pbk-test-1": key }),
  }), /current_binding_key_missing/);
  assert.throws(() => loadAppIntegrityConfig({
    INTEGRITY_ENVIRONMENT: "production",
    INTEGRITY_PRINCIPAL_BINDING_CURRENT_VERSION: "pbk-test-1",
    INTEGRITY_PRINCIPAL_BINDING_KEYS_JSON: JSON.stringify({ "pbk-test-1": `${key}=` }),
  }));
});

test("principal e sessão são vinculados por HMAC versionado sem persistir bearer", () => {
  const loaded = config();
  const principal = derivePrincipalBinding({
    config: loaded,
    version: loaded.principalBindingCurrentVersion,
    userId: "20000000-0000-4000-8000-000000000002",
    providerSubject: "user_clerk_test",
  });
  assert.match(principal, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(principal, derivePrincipalBinding({
    config: loaded,
    version: "pbk-test-1",
    userId: "20000000-0000-4000-8000-000000000002",
    providerSubject: "user_clerk_test",
  }));
  assert.match(deriveAuthSessionHash({
    config: loaded,
    version: "pbk-test-1",
    providerSessionId: "sess_clerk_test",
  }), /^[a-f0-9]{64}$/);
});

test("digest canônico e envelope vinculam provider e proof digest", () => {
  const { canonical, requestDigest } = canonicalEnvelope(AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT);
  assert.equal(requestDigest, createHash("sha256").update(canonical, "utf8").digest("base64url"));
  const proofDigest = sha256Hex("proof");
  const apple = integrityEnvelopeDigest({ canonical, provider: "apple_app_attest", proofDigest });
  const google = integrityEnvelopeDigest({ canonical, provider: "google_play_integrity_standard", proofDigest });
  assert.match(apple, /^[a-f0-9]{64}$/);
  assert.notEqual(apple, google);
});

test("todos os adapters da Fase A retornam apenas indeterminate", async () => {
  for (const adapter of Object.values(PHASE_A_PROVIDER_ADAPTERS)) {
    assert.deepEqual(await adapter.evaluate(), {
      status: "indeterminate",
      outcomeCode: "provider_not_implemented_phase_a",
      appBuildDecision: "not_evaluated",
      deviceDecision: "not_evaluated",
    });
  }
  assert.equal(APP_INTEGRITY_PHASE_A_POLICY_VERSION, "app-integrity-phase-a.v1");
});

test("contratos Zod vinculam plataforma, capability, faixa e provider antes da rota", () => {
  const iosEnvelope = {
    challengeId: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.challengeId,
    challengeNonce: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.challengeNonce,
    deviceBindingId: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.deviceBindingId,
    canonicalizationVersion: "age-integrity-v1",
    clientContext: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.clientContext,
    signal: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.signal,
    proof: {
      provider: "apple_app_attest",
      keyId: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.proofKeyId,
      assertion: Buffer.alloc(16, 1).toString("base64"),
    },
  };
  assert.equal(VerifiedPlatformAgeSignalEnvelopeSchema.safeParse(iosEnvelope).success, true);
  assert.equal(VerifiedPlatformAgeSignalEnvelopeSchema.safeParse({
    ...iosEnvelope,
    clientContext: {
      ...iosEnvelope.clientContext,
      osApiGeneration: "android",
      ageApiCapability: "play_age_signals_available",
    },
  }).success, false);
  assert.equal(VerifiedPlatformAgeSignalEnvelopeSchema.safeParse({
    ...iosEnvelope,
    signal: { platform: "ios", status: "not_shared", ageBand: "18_plus" },
  }).success, false);
  assert.equal(VerifiedPlatformAgeSignalEnvelopeSchema.safeParse({
    ...iosEnvelope,
    proof: { provider: "google_play_integrity_standard", integrityToken: "opaque-token-value-1234" },
  }).success, false);

  assert.equal(CreateIntegrityChallengeRequestSchema.safeParse({
    purpose: "platform_age_signal",
    platform: "android",
    deviceBindingId: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.deviceBindingId,
    appleKeyId: AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT.proofKeyId,
  }).success, false);
});

test("resposta pública de verificação rejeita qualquer material interno extra", () => {
  const response = {
    verificationId: "5c59152b-9134-4d4d-a046-24928fb13e6f",
    status: "indeterminate",
    statusUrl: "/api/v1/integrity/verifications/5c59152b-9134-4d4d-a046-24928fb13e6f",
    retryAfterSeconds: null,
    decision: "verification_unavailable",
  };
  assert.equal(IntegrityVerificationResponseSchema.safeParse(response).success, true);
  assert.equal(IntegrityVerificationResponseSchema.safeParse({
    ...response,
    proofDigest: "a".repeat(64),
  }).success, false);
});
