import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT,
  APPLE_CHALLENGE_GOLDEN_VECTOR,
  AgeIntegrityCanonicalInputSchema,
  appleChallengeUtf8,
  canonicalizeAgeIntegrity,
  decodeCanonicalBase64Url,
  normalizeIosAgeRangeFailClosed,
} from "./index.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const base64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

test("challenge Apple usa os 43 bytes UTF-8 da string Base64URL, nunca os 32 bytes decodificados", () => {
  const utf8 = appleChallengeUtf8(APPLE_CHALLENGE_GOLDEN_VECTOR.challengeString);
  assert.equal(utf8.byteLength, APPLE_CHALLENGE_GOLDEN_VECTOR.utf8Length);
  assert.equal(hex(utf8), APPLE_CHALLENGE_GOLDEN_VECTOR.utf8Hex);
  const digest = createHash("sha256").update(utf8).digest();
  assert.equal(digest.toString("hex"), APPLE_CHALLENGE_GOLDEN_VECTOR.sha256Hex);
  assert.equal(base64Url(digest), APPLE_CHALLENGE_GOLDEN_VECTOR.sha256Base64Url);
  assert.notEqual(
    createHash("sha256").update(decodeCanonicalBase64Url(APPLE_CHALLENGE_GOLDEN_VECTOR.challengeString)).digest("hex"),
    APPLE_CHALLENGE_GOLDEN_VECTOR.sha256Hex,
  );
});

test("fallback expo-age-range iOS 25 com lowerBound 18 falha fechado", () => {
  assert.deepEqual(normalizeIosAgeRangeFailClosed({
    osMajor: 25,
    capabilityAvailable: false,
    response: { lowerBound: 18, upperBound: null },
  }), { status: "unsupported", ageBand: null });
});

test("canonicalização é determinística, LF-only, sem LF final e com ordem fixa", () => {
  const canonical = canonicalizeAgeIntegrity(AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT);
  assert.equal(canonical.includes("\r"), false);
  assert.equal(canonical.endsWith("\n"), false);
  assert.equal(canonical.split("\n").length, 19);
  assert.match(canonical, /^domain=iaaprova\.platform-age-signal\nversion=1\nchallenge_id=/);
  assert.match(canonical, /\nproof_key_id=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$/);
});

test("schemas fechados rejeitam Unicode, CRLF, padding Base64, UUID uppercase e campo extra", () => {
  const valid = structuredClone(AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT);
  assert.throws(() => AgeIntegrityCanonicalInputSchema.parse({ ...valid, unexpected: true }));
  assert.throws(() => AgeIntegrityCanonicalInputSchema.parse({ ...valid, challengeId: valid.challengeId.toUpperCase() }));
  assert.throws(() => AgeIntegrityCanonicalInputSchema.parse({ ...valid, challengeNonce: `${valid.challengeNonce}=` }));
  assert.throws(() => AgeIntegrityCanonicalInputSchema.parse({
    ...valid,
    clientContext: { ...valid.clientContext, runtimeVersion: "versão" },
  }));
  assert.throws(() => AgeIntegrityCanonicalInputSchema.parse({
    ...valid,
    clientContext: { ...valid.clientContext, runtimeVersion: "runtime\r\nforjado" },
  }));
});

test("claims iOS antigo/capability ausente podem ser vinculados, mas não carregar faixa adulta", () => {
  const valid = structuredClone(AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT);
  assert.throws(() => canonicalizeAgeIntegrity({
    ...valid,
    clientContext: {
      ...valid.clientContext,
      osApiGeneration: "ios_pre_26",
      ageApiCapability: "unsupported",
    },
  }));
  assert.doesNotThrow(() => canonicalizeAgeIntegrity({
    ...valid,
    clientContext: {
      ...valid.clientContext,
      osApiGeneration: "ios_pre_26",
      ageApiCapability: "unsupported",
    },
    signal: { platform: "ios", status: "unsupported", ageBand: null },
  }));
});
