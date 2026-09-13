import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PostgreSQL claim is transactional, skip-locked, leased and type-scoped", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  assert.match(source, /query\("BEGIN"\)/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /event_type = ANY\(\$5::text\[\]\)/);
  assert.match(source, /SET available_at = \$3,[\s\S]*attempts = event\.attempts \+ 1/);
  assert.match(source, /query\("COMMIT"\)/);
  assert.match(source, /WHERE id = \$1 AND attempts = \$2 AND processed_at IS NULL/);
});

test("DSR repository keeps ownership checks and uses the real guardian invitation columns", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  assert.match(source, /request\.user_id = \$2 AND request\.kind = 'export'/);
  assert.match(source, /user_id = \$2 OR subject_hash = encode\(digest\(\$2::text, 'sha256'\), 'hex'\)/);
  assert.match(source, /used_at AS accepted_at/);
  assert.doesNotMatch(source, /SELECT id,[\s\S]{0,180}\bstatus, expires_at, accepted_at\b/);
  assert.match(source, /evidence = \$3::jsonb AS matches/);
  assert.match(source, /ON CONFLICT \(request_id, step\) DO NOTHING/);
});

test("DSR export revocation locks the exact owner set and persists append-only proof", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  assert.match(source, /kind = 'export' AND status = 'completed'[\s\S]*export_revoked_at IS NULL/);
  assert.match(source, /ORDER BY requested_at, id FOR UPDATE/);
  assert.match(source, /privacy_export_revocation_set_changed/);
  assert.match(source, /expectedKey = `dsr\/exports\/\$\{object\.requestId\}\/\$\{object\.checksumSha256\}\.json`/);
  assert.match(source, /event_type, object_generation, request_correlation_id[\s\S]*'revoked'/);
  assert.match(source, /'export_objects_revoked'/);
});

test("DSR export includes simulation activity without answer keys or internal snapshots", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  const exportMethod = source.slice(
    source.indexOf("async buildUserExportSnapshot"),
    source.indexOf("async recordDataRequestStep"),
  );
  assert.match(exportMethod, /read\("simulationSessions"/);
  assert.match(exportMethod, /FROM simulation_sessions WHERE user_id = \$1/);
  assert.match(exportMethod, /read\("simulationAnswers"/);
  assert.match(exportMethod, /INNER JOIN simulation_sessions session ON session\.id = answer\.simulation_id/);
  assert.match(exportMethod, /WHERE session\.user_id = \$1/);
  const simulationProjection = exportMethod.slice(
    exportMethod.indexOf('read("simulationSessions"'),
    exportMethod.indexOf('read("simulationAnswers"'),
  );
  assert.doesNotMatch(simulationProjection, /snapshot|correct_option|create_idempotency|result_hash/i);
  const answerProjection = exportMethod.slice(
    exportMethod.indexOf('read("simulationAnswers"'),
    exportMethod.indexOf('read("consents"'),
  );
  assert.doesNotMatch(answerProjection, /correct_option|idempotency_key|statement|solution/i);
});

test("DSR export projects integrity state without replay or cryptographic material", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  const exportMethod = source.slice(
    source.indexOf("async buildUserExportSnapshot"),
    source.indexOf("async recordDataRequestStep"),
  );
  for (const dataset of [
    "platformAgeSignals",
    "integrityDeviceBindings",
    "appIntegrityKeys",
    "integrityChallenges",
    "integrityVerifications",
  ]) {
    assert.match(exportMethod, new RegExp(`read\\(\\"${dataset}\\"`));
  }
  const integrityProjection = exportMethod.slice(
    exportMethod.indexOf('read("platformAgeSignals"'),
    exportMethod.indexOf('read("simulationSessions"'),
  );
  assert.doesNotMatch(
    integrityProjection,
    /nonce_hash|proof_digest|request_digest|envelope_digest|key_id(?:_hash)?|public_key_spki|last_assertion_counter|receipt_ciphertext|proof_ciphertext/i,
  );
  assert.match(integrityProjection, /assurance_kind, verified_at, expires_at/);
  assert.match(integrityProjection, /outcome_code, app_build_decision, device_decision/);
});

test("DSR deletion revokes integrity access before owner rows cascade", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  const revokeMethod = source.slice(
    source.indexOf("async revokeUserAccess"),
    source.indexOf("async eraseUserData"),
  );
  assert.match(revokeMethod, /UPDATE integrity_verifications[\s\S]*status = 'indeterminate'/);
  assert.match(revokeMethod, /UPDATE integrity_challenges[\s\S]*proof_ciphertext = NULL/);
  assert.match(revokeMethod, /UPDATE app_integrity_keys[\s\S]*status = 'revoked'/);
  assert.match(revokeMethod, /UPDATE integrity_device_bindings[\s\S]*status = 'revoked'/);
  assert.ok(
    revokeMethod.indexOf("UPDATE integrity_verifications") < revokeMethod.indexOf("COMMIT"),
    "integrity revocation must be committed as part of access revocation",
  );
});

test("simulation deadline locks before DB clock, rehydrates immutable rows and never touches mastery", async () => {
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  const simulationMethod = source.slice(
    source.indexOf("async finalizeSimulationDeadline"),
    source.indexOf("async getDataRequest"),
  );
  assert.match(simulationMethod, /SELECT id FROM simulation_sessions WHERE id = \$1 FOR UPDATE/);
  assert.ok(
    simulationMethod.indexOf("FOR UPDATE") < simulationMethod.indexOf("clock_timestamp()"),
    "database clock must be observed only after acquiring the session row lock",
  );
  assert.match(simulationMethod, /FROM simulation_questions/);
  assert.match(simulationMethod, /FROM simulation_answers/);
  assert.match(simulationMethod, /computeSimulationResult/);
  assert.match(simulationMethod, /WHERE id = \$1 AND status = 'active'/);
  assert.match(simulationMethod, /simulation\.finalized\.deadline/);
  assert.doesNotMatch(simulationMethod, /topic_mastery|review_schedules|attempts|valid_for_calibration/i);
});
