import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routesUrl = new URL("../routes/integrity.ts", import.meta.url);
const v1Url = new URL("../routes/v1.ts", import.meta.url);

test("integrity routes are mounted only after authenticated principal resolution", async () => {
  const source = await readFile(v1Url, "utf8");
  assert.match(source, /import integrityRouter from "\.\/integrity"/);
  const principal = source.indexOf("router.use(requirePrincipal)");
  const integrity = source.indexOf("router.use(integrityRouter)");
  assert.ok(principal >= 0 && integrity > principal, "integrity routes must be behind requirePrincipal");
});

test("every integrity object lookup is owner scoped and polling cannot disclose another account", async () => {
  const source = await readFile(routesUrl, "utf8");
  for (const table of [
    "integrityDeviceBindingsTable",
    "integrityChallengesTable",
    "integrityVerificationsTable",
  ]) {
    assert.match(
      source,
      new RegExp(`eq\\(${table}\\.userId, (?:principal\\.userId|res\\.locals\\.principal\\.userId)\\)`),
      `${table} needs an authenticated owner predicate`,
    );
  }
  const poll = source.slice(source.indexOf('router.get("/integrity/verifications/:verificationId"'));
  assert.match(poll, /eq\(integrityVerificationsTable\.id, verificationId\)/);
  assert.match(poll, /eq\(integrityVerificationsTable\.userId, res\.locals\.principal\.userId\)/);
});

test("mutable integrity requests bind idempotency to payload and reject reuse", async () => {
  const source = await readFile(routesUrl, "utf8");
  const binding = source.slice(
    source.indexOf('router.post("/integrity/device-bindings"'),
    source.indexOf('router.post("/integrity/challenges"'),
  );
  assert.match(binding, /requireIdempotencyKey\(req\)/);
  assert.match(binding, /existingOperation\.requestHash !== requestDigest/);
  assert.match(binding, /HttpError\(409, "Conflito de idempotência"/);

  const verification = source.slice(source.indexOf('router.post("/me/platform-age-signal/verified"'));
  assert.match(verification, /requireIdempotencyKey\(req\)/);
  assert.match(verification, /constantTimeTextEqual\(existing\.envelopeDigest, envelopeDigest\)/);
  assert.match(verification, /HttpError\(409, "Conflito de idempotência"/);
});

test("Phase A finalization is fenced, terminal and cannot elevate platform age trust", async () => {
  const source = await readFile(routesUrl, "utf8");
  assert.match(source, /PHASE_A_PROVIDER_ADAPTERS\[provider\]\.evaluate\(\)/);
  assert.match(source, /eq\(integrityChallengesTable\.leaseGeneration, reservation\.leaseGeneration\)/);
  assert.match(source, /eq\(integrityChallengesTable\.verificationAttemptId, reservation\.verificationId\)/);
  assert.match(source, /status: "indeterminate"/);
  assert.doesNotMatch(source, /trustStatus:\s*"server_verified"/);
  assert.doesNotMatch(source, /status:\s*"verified"/);
  assert.doesNotMatch(source, /platformAgeSignalsTable/);
});

test("public responses are explicit allowlists and omit provider evidence", async () => {
  const source = await readFile(routesUrl, "utf8");
  const response = source.slice(
    source.indexOf("export function sanitizedVerificationResponse"),
    source.indexOf('router.post("/integrity/device-bindings"'),
  );
  assert.match(response, /IntegrityVerificationResponseSchema\.parse/);
  assert.doesNotMatch(response, /proofDigest|requestDigest|envelopeDigest|counter|receipt|verdict|nonceHash|publicKey/i);
});
