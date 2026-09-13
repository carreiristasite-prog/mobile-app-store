import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { assertSafeTestDatabaseUrl } from "./database-guard.mjs";
import { applyMigrations } from "./migrations.mjs";
import {
  computeSimulationResult,
  createSimulationSnapshot,
  createSimulationState,
  finishSimulationAtTime,
} from "../../simulation-engine/src/index.ts";

const rawDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!rawDatabaseUrl) {
  test("integração PostgreSQL requer TEST_DATABASE_URL explicitamente segura", { skip: true }, () => {});
} else {
  const safety = assertSafeTestDatabaseUrl(rawDatabaseUrl);
  const schema = `ia_aprova_it_${process.pid}_${randomBytes(4).toString("hex")}`;
  let adminPool;
  let pool;
  let repository;
  let firstMigrationRun;
  let fixture;

  function quotedIdentifier(identifier) {
    if (!/^ia_aprova_it_[a-z0-9_]+$/.test(identifier)) throw new Error("schema efêmero inválido");
    return `"${identifier}"`;
  }

  async function assertPostgresError(action, code) {
    await assert.rejects(action, (error) => {
      assert.equal(error?.code, code);
      return true;
    });
  }

  async function createUser(clerkId, email) {
    const result = await pool.query(
      `INSERT INTO users(clerk_user_id, email, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [clerkId, email, clerkId],
    );
    return result.rows[0].id;
  }

  async function seedFixture() {
    const learner = await createUser("clerk_test_learner", "learner@test.invalid");
    const minor = await createUser("clerk_test_minor", "minor@test.invalid");
    const guardianOne = await createUser("clerk_test_guardian_1", "guardian1@test.invalid");
    const guardianTwo = await createUser("clerk_test_guardian_2", "guardian2@test.invalid");
    await pool.query(
      `INSERT INTO age_profiles(user_id, age_band) VALUES
       ($1, '13_15'), ($2, '18_plus'), ($3, '18_plus')`,
      [minor, guardianOne, guardianTwo],
    );
    await pool.query("INSERT INTO products(id, slug, name, category) VALUES ('eear', 'eear', 'EEAR', 'militares')");
    const exam = await pool.query(
      "INSERT INTO exam_versions(product_id, code, status) VALUES ('eear', 'test-v1', 'draft') RETURNING id",
    );
    await pool.query("INSERT INTO subjects(id, slug, name) VALUES ('matematica', 'matematica', 'Matemática')");
    const topic = await pool.query(
      "INSERT INTO topics(subject_id, slug, name) VALUES ('matematica', 'algebra', 'Álgebra') RETURNING id",
    );
    const item = await pool.query(
      `INSERT INTO question_items(canonical_hash, origin)
       VALUES ($1, 'original_authoral') RETURNING id`,
      ["a".repeat(64)],
    );
    const version = await pool.query(
      `INSERT INTO question_versions(
         question_item_id, version, exam_version_id, subject_id, topic_id,
         statement, solution, difficulty, skill, status, content_hash
       ) VALUES ($1, 1, $2, 'matematica', $3, $4, $5, 'medium', 'resolver', 'beta', $6)
       RETURNING id`,
      [item.rows[0].id, exam.rows[0].id, topic.rows[0].id, "Quanto é 2 + 2?", "2 + 2 = 4.", "b".repeat(64)],
    );
    const options = await pool.query(
      `INSERT INTO question_options(question_version_id, key, body, is_correct, rationale, order_index)
       VALUES
         ($1, 'A', '3', false, 'Soma incorreta.', 0),
         ($1, 'B', '4', true, 'Soma correta.', 1)
       RETURNING id, key`,
      [version.rows[0].id],
    );
    const correctOption = options.rows.find((row) => row.key === "B").id;
    const session = await pool.query(
      `INSERT INTO learning_sessions(
         user_id, product_id, exam_version_id, mode, algorithm_version, seed
       ) VALUES ($1, 'eear', $2, 'practice', 'bayes-v1', 'integration-seed') RETURNING id`,
      [learner, exam.rows[0].id],
    );
    const exposure = await pool.query(
      `INSERT INTO item_exposures(
         session_id, user_id, question_version_id, sequence, selection_bucket
       ) VALUES ($1, $2, $3, 1, 'coverage') RETURNING id`,
      [session.rows[0].id, learner, version.rows[0].id],
    );
    return {
      learner,
      minor,
      guardianOne,
      guardianTwo,
      exam: exam.rows[0].id,
      topic: topic.rows[0].id,
      item: item.rows[0].id,
      version: version.rows[0].id,
      correctOption,
      optionIds: options.rows.sort((left, right) => left.key.localeCompare(right.key)).map((row) => row.id),
      session: session.rows[0].id,
      exposure: exposure.rows[0].id,
    };
  }

  before(async () => {
    const pg = (await import("pg")).default;
    const { Pool } = pg;
    adminPool = new Pool({ connectionString: safety.connectionString, max: 2, connectionTimeoutMillis: 5_000 });
    const target = await adminPool.query("SELECT current_database() AS database");
    assert.equal(target.rows[0].database, safety.database);
    await adminPool.query(`CREATE SCHEMA ${quotedIdentifier(schema)}`);
    pool = new Pool({
      connectionString: safety.connectionString,
      options: `-c search_path=${schema}`,
      max: 12,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: "ia-aprova-postgres-integration",
    });
    firstMigrationRun = await applyMigrations(pool, safety);
    const workerModule = await import("../../../artifacts/worker/src/repository.ts");
    repository = new workerModule.PostgresWorkerRepository(pool);
    fixture = await seedFixture();
  });

  after(async () => {
    await pool?.end();
    if (adminPool) {
      const target = await adminPool.query("SELECT current_database() AS database");
      assert.equal(target.rows[0].database, safety.database);
      await adminPool.query(`DROP SCHEMA ${quotedIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  test("aplica migrations em ordem e o replay é idempotente", async () => {
    assert.equal(firstMigrationRun.applied.length, firstMigrationRun.hashes.length);
    assert.equal(firstMigrationRun.skipped.length, 0);
    const replay = await applyMigrations(pool, safety);
    assert.deepEqual(replay.applied, []);
    assert.deepEqual(replay.skipped, replay.hashes);
    const recorded = await pool.query("SELECT hash FROM __drizzle_migrations__ ORDER BY hash");
    assert.deepEqual(recorded.rows.map((row) => row.hash), replay.hashes);
  });

  test("App Integrity Fase A protege ownership, idempotência, replay, expiração e fencing", async () => {
    const otherUser = await createUser("clerk_test_integrity_other", "integrity-other@test.invalid");
    const binding = await pool.query(
      `INSERT INTO integrity_device_bindings(user_id, installation_digest, platform, environment)
       VALUES ($1, $2, 'android', 'development') RETURNING id`,
      [fixture.learner, "1".repeat(64)],
    );
    const bindingId = binding.rows[0].id;
    const insertChallenge = async (suffix) => pool.query(
      `INSERT INTO integrity_challenges(
         user_id, device_binding_id, auth_session_hash, purpose, platform, environment,
         nonce_hash, principal_binding_hash, principal_binding_key_version,
         canonicalization_version, expires_at
       ) VALUES ($1, $2, $3, 'platform_age_signal', 'android', 'development',
                 $4, $5, 'pbk-test-1', 'age-integrity-v1', now() + interval '2 minutes')
       RETURNING id`,
      [fixture.learner, bindingId, suffix.repeat(64), suffix.repeat(64), suffix.repeat(64)],
    );

    await assertPostgresError(
      pool.query(
        `INSERT INTO integrity_challenges(
           user_id, device_binding_id, auth_session_hash, purpose, platform, environment,
           nonce_hash, principal_binding_hash, principal_binding_key_version,
           canonicalization_version, expires_at
         ) VALUES ($1, $2, $3, 'platform_age_signal', 'android', 'development',
                   $3, $3, 'pbk-test-1', 'age-integrity-v1', now() + interval '2 minutes')`,
        [otherUser, bindingId, "a".repeat(64)],
      ),
      "23503",
    );

    const firstChallenge = await insertChallenge("b");
    const firstChallengeId = firstChallenge.rows[0].id;
    await assertPostgresError(
      pool.query(
        `INSERT INTO integrity_verifications(
           user_id, device_binding_id, challenge_id, provider, purpose, platform,
           environment, status, idempotency_key, envelope_digest, request_digest,
           proof_digest, policy_version, issued_at
         ) VALUES ($1, $2, $3, 'google_play_integrity_standard', 'platform_age_signal',
                   'android', 'development', 'verifying', 'cross-owner-integrity',
                   $4, $5, $6, 'app-integrity-phase-a.v1', now())`,
        [otherUser, bindingId, firstChallengeId, "c".repeat(64), "D".repeat(43), "d".repeat(64)],
      ),
      "23503",
    );

    const proofDigest = "e".repeat(64);
    const requestDigest = "F".repeat(43);
    const idempotencyKey = "integrity-first-request";
    const firstClient = await pool.connect();
    let verificationId;
    try {
      await firstClient.query("BEGIN");
      const verification = await firstClient.query(
        `INSERT INTO integrity_verifications(
           user_id, device_binding_id, challenge_id, provider, purpose, platform,
           environment, status, idempotency_key, envelope_digest, request_digest,
           proof_digest, policy_version, issued_at
         ) VALUES ($1, $2, $3, 'google_play_integrity_standard', 'platform_age_signal',
                   'android', 'development', 'verifying', $4, $5, $6, $7,
                   'app-integrity-phase-a.v1', now()) RETURNING id`,
        [fixture.learner, bindingId, firstChallengeId, idempotencyKey, "f".repeat(64), requestDigest, proofDigest],
      );
      verificationId = verification.rows[0].id;
      await firstClient.query(
        `UPDATE integrity_challenges
         SET status = 'verifying', proof_digest = $2, request_digest = $3,
             idempotency_key = $4, verification_attempt_id = $5,
             lease_generation = 1, lease_owner = 'integration-worker',
             lease_expires_at = now() + interval '30 seconds', reserved_at = now(), attempt_count = 1
         WHERE id = $1`,
        [firstChallengeId, proofDigest, requestDigest, idempotencyKey, verificationId],
      );
      await firstClient.query("COMMIT");
    } catch (error) {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      firstClient.release();
    }

    const secondChallenge = await insertChallenge("1");
    await assertPostgresError(
      pool.query(
        `INSERT INTO integrity_verifications(
           user_id, device_binding_id, challenge_id, provider, purpose, platform,
           environment, status, idempotency_key, envelope_digest, request_digest,
           proof_digest, policy_version, issued_at
         ) VALUES ($1, $2, $3, 'google_play_integrity_standard', 'platform_age_signal',
                   'android', 'development', 'verifying', $4, $5, $6, $7,
                   'app-integrity-phase-a.v1', now())`,
        [fixture.learner, bindingId, secondChallenge.rows[0].id, idempotencyKey, "2".repeat(64), "G".repeat(43), "3".repeat(64)],
      ),
      "23505",
    );

    const replayClient = await pool.connect();
    try {
      await replayClient.query("BEGIN");
      const replayVerification = await replayClient.query(
        `INSERT INTO integrity_verifications(
           user_id, device_binding_id, challenge_id, provider, purpose, platform,
           environment, status, idempotency_key, envelope_digest, request_digest,
           proof_digest, policy_version, issued_at
         ) VALUES ($1, $2, $3, 'google_play_integrity_standard', 'platform_age_signal',
                   'android', 'development', 'verifying', 'integrity-replay-request',
                   $4, $5, $6, 'app-integrity-phase-a.v1', now()) RETURNING id`,
        [fixture.learner, bindingId, secondChallenge.rows[0].id, "4".repeat(64), "H".repeat(43), "5".repeat(64)],
      );
      await assertPostgresError(
        replayClient.query(
          `UPDATE integrity_challenges
           SET status = 'verifying', proof_digest = $2, request_digest = $3,
               idempotency_key = 'integrity-replay-request', verification_attempt_id = $4,
               lease_generation = 1, lease_owner = 'integration-worker',
               lease_expires_at = now() + interval '30 seconds', reserved_at = now(), attempt_count = 1
           WHERE id = $1`,
          [secondChallenge.rows[0].id, proofDigest, "H".repeat(43), replayVerification.rows[0].id],
        ),
        "23505",
      );
      await replayClient.query("ROLLBACK");
    } finally {
      replayClient.release();
    }

    const stale = await pool.connect();
    try {
      await stale.query("BEGIN");
      await stale.query(
        `UPDATE integrity_verifications
         SET status = 'indeterminate', outcome_code = 'stale_worker', terminal_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'verifying'`,
        [verificationId],
      );
      const staleFence = await stale.query(
        `UPDATE integrity_challenges
         SET status = 'indeterminate', failure_code = 'stale_worker', terminal_at = now()
         WHERE id = $1 AND status = 'verifying' AND lease_generation = 0`,
        [firstChallengeId],
      );
      assert.equal(staleFence.rowCount, 0);
      await stale.query("ROLLBACK");
    } finally {
      stale.release();
    }
    const afterStale = await pool.query("SELECT status FROM integrity_verifications WHERE id = $1", [verificationId]);
    assert.equal(afterStale.rows[0].status, "verifying");

    const current = await pool.connect();
    try {
      await current.query("BEGIN");
      await current.query(
        `UPDATE integrity_verifications
         SET status = 'indeterminate', outcome_code = 'provider_not_implemented_phase_a',
             app_build_decision = 'not_evaluated', device_decision = 'not_evaluated',
             terminal_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'verifying'`,
        [verificationId],
      );
      const fenced = await current.query(
        `UPDATE integrity_challenges
         SET status = 'indeterminate', failure_code = 'provider_not_implemented_phase_a',
             terminal_at = now(), lease_owner = NULL, lease_expires_at = NULL
         WHERE id = $1 AND status = 'verifying' AND lease_generation = 1
           AND verification_attempt_id = $2`,
        [firstChallengeId, verificationId],
      );
      assert.equal(fenced.rowCount, 1);
      await current.query("COMMIT");
    } catch (error) {
      await current.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      current.release();
    }

    await assertPostgresError(
      pool.query("UPDATE integrity_challenges SET failure_code = 'rewritten' WHERE id = $1", [firstChallengeId]),
      "23514",
    );
    await assertPostgresError(
      pool.query("UPDATE integrity_verifications SET outcome_code = 'rewritten' WHERE id = $1", [verificationId]),
      "23514",
    );

    const expiring = await insertChallenge("6");
    await pool.query(
      `UPDATE integrity_challenges
       SET status = 'expired', terminal_at = now(), failure_code = 'challenge_expired'
       WHERE id = $1`,
      [expiring.rows[0].id],
    );
    await assertPostgresError(
      pool.query("UPDATE integrity_challenges SET status = 'issued' WHERE id = $1", [expiring.rows[0].id]),
      "23514",
    );

    await pool.query(
      `INSERT INTO platform_age_signals(
         user_id, platform, source, sharing_status, age_band, trust_status
       ) VALUES ($1, 'android', 'google_play_age_signals', 'shared', '18_plus', 'device_reported_monitoring')
       ON CONFLICT (user_id, platform) DO NOTHING`,
      [fixture.learner],
    );
    await assertPostgresError(
      pool.query(
        `UPDATE platform_age_signals
         SET trust_status = 'server_verified', verification_id = $2,
             assurance_kind = 'integrity_bound_report', verified_at = now(),
             expires_at = now() + interval '30 days', verified_build = 'test-build',
             verification_policy_version = 'app-integrity-phase-a.v1'
         WHERE user_id = $1 AND platform = 'android'`,
        [fixture.learner, verificationId],
      ),
      "23514",
    );
  });

  test("DSR exporta projeção de integridade, revoga acesso e apaga vínculos do titular", async () => {
    const userId = await createUser("clerk_test_integrity_dsr", "integrity-dsr@test.invalid");
    await pool.query(
      `INSERT INTO auth_identities(user_id, provider, subject)
       VALUES ($1, 'clerk', 'user_integrity_dsr')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO billing_customers(user_id) VALUES ($1)`,
      [userId],
    );
    await pool.query("INSERT INTO age_profiles(user_id, age_band) VALUES ($1, '18_plus')", [userId]);
    const binding = await pool.query(
      `INSERT INTO integrity_device_bindings(user_id, installation_digest, platform, environment)
       VALUES ($1, $2, 'ios', 'development') RETURNING id`,
      [userId, "7".repeat(64)],
    );
    await pool.query(
      `INSERT INTO app_integrity_keys(
         user_id, device_binding_id, platform, environment, key_id, key_id_hash
       ) VALUES ($1, $2, 'ios', 'development', $3, $4)`,
      [userId, binding.rows[0].id, "K".repeat(43), "8".repeat(64)],
    );
    await pool.query(
      `INSERT INTO integrity_challenges(
         user_id, device_binding_id, auth_session_hash, purpose, platform, environment,
         apple_key_id_hash, nonce_hash, principal_binding_hash,
         principal_binding_key_version, canonicalization_version, expires_at
       ) VALUES ($1, $2, $3, 'platform_age_signal', 'ios', 'development',
                 $4, $5, $6, 'pbk-test-1', 'age-integrity-v1', now() + interval '2 minutes')`,
      [userId, binding.rows[0].id, "9".repeat(64), "a".repeat(64), "b".repeat(64), "c".repeat(64)],
    );
    await pool.query(
      `INSERT INTO platform_age_signals(
         user_id, platform, source, sharing_status, age_band, trust_status
       ) VALUES ($1, 'ios', 'apple_declared_age_range', 'shared', '18_plus', 'device_reported_monitoring')`,
      [userId],
    );

    const subjectHash = createHash("sha256").update(userId).digest("hex");
    const exportRequest = await pool.query(
      `INSERT INTO data_requests(user_id, subject_hash, kind)
       VALUES ($1, $2, 'export') RETURNING id`,
      [userId, subjectHash],
    );
    await pool.query(
      `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
       VALUES ($1, 'requested', $2, '{}'::jsonb)`,
      [exportRequest.rows[0].id, `requested:${exportRequest.rows[0].id}`],
    );
    assert.equal((await repository.startDataRequest({
      requestId: exportRequest.rows[0].id,
      userId,
      kind: "export",
    })).status, "processing");
    const snapshot = await repository.buildUserExportSnapshot({ requestId: exportRequest.rows[0].id, userId });
    assert.equal(snapshot.datasets.platformAgeSignals.length, 1);
    assert.equal(snapshot.datasets.integrityDeviceBindings.length, 1);
    assert.equal(snapshot.datasets.appIntegrityKeys.length, 1);
    assert.equal(snapshot.datasets.integrityChallenges.length, 1);
    assert.deepEqual(snapshot.datasets.integrityVerifications, []);
    const serialized = JSON.stringify({
      platformAgeSignals: snapshot.datasets.platformAgeSignals,
      integrityDeviceBindings: snapshot.datasets.integrityDeviceBindings,
      appIntegrityKeys: snapshot.datasets.appIntegrityKeys,
      integrityChallenges: snapshot.datasets.integrityChallenges,
      integrityVerifications: snapshot.datasets.integrityVerifications,
    });
    for (const forbidden of [
      "nonce_hash", "proof_digest", "request_digest", "envelope_digest", "key_id",
      "key_id_hash", "public_key_spki", "last_assertion_counter", "receipt_ciphertext", "proof_ciphertext",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `DSR leaked ${forbidden}`);
    }

    await pool.query(
      `UPDATE data_requests SET status = 'failed', error_code = 'integration_snapshot_only', updated_at = now()
       WHERE id = $1`,
      [exportRequest.rows[0].id],
    );
    const deletionRequest = await pool.query(
      `INSERT INTO data_requests(user_id, subject_hash, kind)
       VALUES ($1, $2, 'deletion') RETURNING id`,
      [userId, subjectHash],
    );
    await pool.query(
      `INSERT INTO data_request_evidence(request_id, step, idempotency_key, evidence)
       VALUES ($1, 'requested', $2, '{}'::jsonb)`,
      [deletionRequest.rows[0].id, `requested:${deletionRequest.rows[0].id}`],
    );
    await repository.startDataRequest({ requestId: deletionRequest.rows[0].id, userId, kind: "deletion" });
    await repository.revokeUserAccess({ requestId: deletionRequest.rows[0].id, userId });
    const revoked = await pool.query(
      `SELECT
         (SELECT status FROM integrity_device_bindings WHERE user_id = $1 LIMIT 1) AS binding_status,
         (SELECT status FROM app_integrity_keys WHERE user_id = $1 LIMIT 1) AS key_status,
         (SELECT status FROM integrity_challenges WHERE user_id = $1 LIMIT 1) AS challenge_status`,
      [userId],
    );
    assert.deepEqual(revoked.rows[0], {
      binding_status: "revoked",
      key_status: "revoked",
      challenge_status: "expired",
    });

    await repository.recordDataRequestStep({
      requestId: deletionRequest.rows[0].id,
      userId,
      step: "external_accounts_erased",
      phase: "external_accounts_erased",
      idempotencyKey: `external-erased:${deletionRequest.rows[0].id}`,
      evidence: { providers: ["clerk", "revenuecat"] },
    });
    await repository.eraseUserData({
      requestId: deletionRequest.rows[0].id,
      userId,
      retentionPolicy: { id: "integration-retention-v1", sha256: "d".repeat(64) },
    });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE id = $1", [userId])).rows[0].count, 0);
    assert.equal((await pool.query(
      `SELECT
         (SELECT count(*)::int FROM integrity_device_bindings WHERE user_id = $1)
       + (SELECT count(*)::int FROM app_integrity_keys WHERE user_id = $1)
       + (SELECT count(*)::int FROM integrity_challenges WHERE user_id = $1)
       + (SELECT count(*)::int FROM integrity_verifications WHERE user_id = $1) AS count`,
      [userId],
    )).rows[0].count, 0);
    const deletion = await pool.query(
      "SELECT user_id, subject_hash, phase FROM data_requests WHERE id = $1",
      [deletionRequest.rows[0].id],
    );
    assert.deepEqual(deletion.rows[0], { user_id: null, subject_hash: subjectHash, phase: "internal_data_erased" });
  });

  test("constraints rejeitam faixa etária e gabaritos estruturalmente inválidos", async () => {
    const invalidUser = await createUser("clerk_test_invalid_age", "invalid-age@test.invalid");
    await assertPostgresError(
      pool.query("INSERT INTO age_profiles(user_id, age_band) VALUES ($1, '12')", [invalidUser]),
      "23514",
    );

    const signalUser = await createUser("clerk_test_age_signal", "age-signal@test.invalid");
    await pool.query(
      `INSERT INTO platform_age_signals(
         user_id, platform, source, sharing_status, age_band, trust_status
       ) VALUES ($1, 'ios', 'apple_declared_age_range', 'shared', '18_plus', 'device_reported_monitoring')`,
      [signalUser],
    );
    await assertPostgresError(
      pool.query(
        `INSERT INTO platform_age_signals(user_id, platform, source, sharing_status, age_band)
         VALUES ($1, 'android', 'apple_declared_age_range', 'shared', '18_plus')`,
        [signalUser],
      ),
      "23514",
    );
    await assertPostgresError(
      pool.query(
        `UPDATE platform_age_signals SET sharing_status = 'not_shared'
         WHERE user_id = $1 AND platform = 'ios'`,
        [signalUser],
      ),
      "23514",
    );
    await assertPostgresError(
      pool.query(
        `UPDATE platform_age_signals SET trust_status = 'client_verified'
         WHERE user_id = $1 AND platform = 'ios'`,
        [signalUser],
      ),
      "23514",
    );

    const draftVersion = await pool.query(
      `INSERT INTO question_versions(
         question_item_id, version, exam_version_id, subject_id, topic_id,
         statement, solution, difficulty, skill, status, content_hash
       ) VALUES ($1, 2, $2, 'matematica', $3, 'Questão draft', 'Solução', 'easy', 'resolver', 'quarantine', $4)
       RETURNING id`,
      [fixture.item, fixture.exam, fixture.topic, "c".repeat(64)],
    );
    await pool.query(
      `INSERT INTO question_options(question_version_id, key, body, is_correct, rationale, order_index)
       VALUES ($1, 'A', 'A', true, 'Primeira', 0)`,
      [draftVersion.rows[0].id],
    );
    await assertPostgresError(
      pool.query(
        `INSERT INTO question_options(question_version_id, key, body, is_correct, rationale, order_index)
         VALUES ($1, 'B', 'B', true, 'Segunda', 1)`,
        [draftVersion.rows[0].id],
      ),
      "23505",
    );
  });

  async function recordIdentityOperation(userId, key, requestHash) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`identity-op:${userId}:${key}`]);
      const existing = await client.query(
        "SELECT request_hash FROM identity_operations WHERE user_id = $1 AND idempotency_key = $2",
        [userId, key],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return existing.rows[0].request_hash === requestHash ? "replay" : "conflict";
      }
      await client.query(
        `INSERT INTO identity_operations(
           user_id, idempotency_key, operation, request_hash, response
         ) VALUES ($1, $2, 'integration.identity.v1', $3, '{"ok":true}'::jsonb)`,
        [userId, key, requestHash],
      );
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  test("operação de identidade concorrente produz um create, um replay e conflito por payload", async () => {
    const key = "identity-concurrency-key";
    const requestHash = "d".repeat(64);
    const results = await Promise.all([
      recordIdentityOperation(fixture.learner, key, requestHash),
      recordIdentityOperation(fixture.learner, key, requestHash),
    ]);
    assert.deepEqual(results.sort(), ["created", "replay"]);
    assert.equal(await recordIdentityOperation(fixture.learner, key, "e".repeat(64)), "conflict");
    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM identity_operations WHERE user_id = $1 AND idempotency_key = $2",
      [fixture.learner, key],
    );
    assert.equal(rows.rows[0].count, 1);
  });

  test("simulado serializa primeira resposta e protege snapshot/resultado no PostgreSQL", async () => {
    const blueprint = await pool.query(
      `INSERT INTO blueprint_versions(exam_version_id, version, status, rules)
       VALUES ($1, 1, 'published', $2::jsonb) RETURNING id`,
      [fixture.exam, JSON.stringify({
        schemaVersion: "simulation-blueprint-rules.v1",
        questionCount: 1,
        durationMinutes: 60,
        scoring: {
          model: "weighted-sum.v1",
          rounding: { decimalPlaces: 2, mode: "half-away-from-zero" },
          aggregateFloor: { policy: "none" },
        },
        subjects: [{
          subjectId: "matematica",
          questionCount: 1,
          correctPoints: "1",
          weight: "1",
          incorrect: { policy: "zero" },
          unanswered: { policy: "zero" },
        }],
      })],
    );
    const simulationId = "20000000-0000-4000-8000-000000000001";
    const startedAt = new Date("2026-08-23T12:00:00.000Z");
    const deadlineAt = new Date("2026-08-23T13:00:00.000Z");
    const snapshotHash = "1".repeat(64);
    await pool.query(
      `INSERT INTO simulation_sessions(
         id, user_id, product_id, exam_version_id, blueprint_version_id,
         create_idempotency_key, rules, snapshot, snapshot_hash, state,
         started_at, deadline_at
       ) VALUES ($1, $2, 'eear', $3, $4, 'simulation-create-integration',
         '{}'::jsonb, '{}'::jsonb, $5, '{}'::jsonb, $6, $7)`,
      [simulationId, fixture.learner, fixture.exam, blueprint.rows[0].id, snapshotHash, startedAt, deadlineAt],
    );
    await pool.query(
      `INSERT INTO simulation_questions(
         simulation_id, position, question_version_id, subject_id, option_ids, correct_option_id
       ) VALUES ($1, 0, $2, 'matematica', $3::uuid[], $4)`,
      [simulationId, fixture.version, fixture.optionIds, fixture.correctOption],
    );

    const firstOption = fixture.optionIds[0];
    const concurrent = await Promise.allSettled([
      pool.query(
        `INSERT INTO simulation_answers(simulation_id, question_version_id, selected_option_id, idempotency_key, received_at)
         VALUES ($1, $2, $3, 'answer-concurrent-a', $4)`,
        [simulationId, fixture.version, firstOption, new Date(startedAt.getTime() + 1_000)],
      ),
      pool.query(
        `INSERT INTO simulation_answers(simulation_id, question_version_id, selected_option_id, idempotency_key, received_at)
         VALUES ($1, $2, $3, 'answer-concurrent-b', $4)`,
        [simulationId, fixture.version, fixture.correctOption, new Date(startedAt.getTime() + 1_001)],
      ),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected" && result.reason?.code === "23505").length, 1);
    const accepted = await pool.query("SELECT id, selected_option_id FROM simulation_answers WHERE simulation_id = $1", [simulationId]);
    assert.equal(accepted.rowCount, 1);

    await assertPostgresError(
      pool.query("UPDATE simulation_answers SET selected_option_id = $2 WHERE id = $1", [accepted.rows[0].id, fixture.correctOption]),
      "55000",
    );
    await assertPostgresError(
      pool.query("UPDATE simulation_sessions SET snapshot = '{\"forged\":true}'::jsonb WHERE id = $1", [simulationId]),
      "55000",
    );

    const otherItem = await pool.query(
      `INSERT INTO question_items(canonical_hash, origin)
       VALUES ($1, 'original_authoral') RETURNING id`,
      ["7".repeat(64)],
    );
    const otherVersion = await pool.query(
      `INSERT INTO question_versions(
         question_item_id, version, exam_version_id, subject_id, topic_id,
         statement, solution, difficulty, skill, status, content_hash
       ) VALUES ($1, 1, $2, 'matematica', $3, 'Outra questão', 'Outra solução', 'easy', 'resolver', 'draft', $4)
       RETURNING id`,
      [otherItem.rows[0].id, fixture.exam, fixture.topic, "8".repeat(64)],
    );
    const otherOption = await pool.query(
      `INSERT INTO question_options(question_version_id, key, body, is_correct, rationale, order_index)
       VALUES ($1, 'A', 'Outra', true, 'Outra', 0) RETURNING id`,
      [otherVersion.rows[0].id],
    );
    const secondSimulationId = "20000000-0000-4000-8000-000000000002";
    await assertPostgresError(
      pool.query(
        `INSERT INTO simulation_sessions(
           id, user_id, product_id, exam_version_id, blueprint_version_id,
           create_idempotency_key, rules, snapshot, snapshot_hash, state,
           started_at, deadline_at
         ) VALUES ($1, $2, 'eear', $3, $4, 'simulation-create-duplicate-active',
           '{}'::jsonb, '{}'::jsonb, $5, '{}'::jsonb, $6, $7)`,
        [secondSimulationId, fixture.learner, fixture.exam, blueprint.rows[0].id, "2".repeat(64), startedAt, deadlineAt],
      ),
      "23505",
    );
    const secondSimulationUser = await createUser(
      "clerk_test_simulation_other",
      "simulation-other@test.invalid",
    );
    await pool.query(
      `INSERT INTO simulation_sessions(
         id, user_id, product_id, exam_version_id, blueprint_version_id,
         create_idempotency_key, rules, snapshot, snapshot_hash, state,
         started_at, deadline_at
       ) VALUES ($1, $2, 'eear', $3, $4, 'simulation-create-integration-2',
         '{}'::jsonb, '{}'::jsonb, $5, '{}'::jsonb, $6, $7)`,
      [secondSimulationId, secondSimulationUser, fixture.exam, blueprint.rows[0].id, "2".repeat(64), startedAt, deadlineAt],
    );
    await pool.query(
      `INSERT INTO simulation_questions(
         simulation_id, position, question_version_id, subject_id, option_ids, correct_option_id
       ) VALUES ($1, 0, $2, 'matematica', $3::uuid[], $4)`,
      [secondSimulationId, fixture.version, fixture.optionIds, fixture.correctOption],
    );
    await assertPostgresError(
      pool.query(
        `INSERT INTO simulation_answers(simulation_id, question_version_id, selected_option_id, idempotency_key, received_at)
         VALUES ($1, $2, $3, 'wrong-question-option', $4)`,
        [secondSimulationId, fixture.version, otherOption.rows[0].id, new Date(startedAt.getTime() + 2_000)],
      ),
      "23514",
    );

    await pool.query(
      `INSERT INTO auth_identities(user_id, provider, subject)
       VALUES ($1, 'clerk', 'clerk_test_learner')
       ON CONFLICT(provider, subject) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [fixture.learner],
    );
    const exportRequestId = "20000000-0000-4000-8000-000000000003";
    await pool.query(
      `INSERT INTO data_requests(id, user_id, subject_hash, kind, status, phase, processing_started_at)
       VALUES ($1, $2, $3, 'export', 'processing', 'export_snapshot', now())`,
      [exportRequestId, fixture.learner, "3".repeat(64)],
    );
    const exportSnapshot = await repository.buildUserExportSnapshot({
      requestId: exportRequestId,
      userId: fixture.learner,
    });
    assert.equal(exportSnapshot.datasets.simulationSessions.length, 1);
    assert.equal(exportSnapshot.datasets.simulationAnswers.length, 1);
    const exportedSimulationJson = JSON.stringify({
      sessions: exportSnapshot.datasets.simulationSessions,
      answers: exportSnapshot.datasets.simulationAnswers,
    });
    for (const forbidden of [
      "correct_option_id",
      "snapshot",
      "snapshot_hash",
      "result_hash",
      "create_idempotency_key",
      "idempotency_key",
      "statement",
      "solution",
    ]) {
      assert.equal(exportedSimulationJson.includes(forbidden), false, `DSR leaked ${forbidden}`);
    }
    await pool.query(
      `UPDATE data_requests
       SET status = 'failed', error_code = 'integration_cleanup', updated_at = now()
       WHERE id = $1`,
      [exportRequestId],
    );
    await pool.query(
      "DELETE FROM simulation_sessions WHERE id = ANY($1::uuid[])",
      [[simulationId, secondSimulationId]],
    );
  });

  async function acceptGuardianInvitation(tokenDigest, guardianUserId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`guardian-invite:${tokenDigest}`]);
      const invite = await client.query(
        `SELECT id, minor_user_id, used_at, revoked_at, expires_at
         FROM guardian_invitations WHERE token_digest = $1`,
        [tokenDigest],
      );
      const row = invite.rows[0];
      if (!row || row.used_at || row.revoked_at || new Date(row.expires_at) <= new Date()) {
        await client.query("COMMIT");
        return "unavailable";
      }
      const link = await client.query(
        `INSERT INTO guardian_links(minor_user_id, guardian_user_id, status, verified_at)
         VALUES ($1, $2, 'verified', now()) RETURNING id`,
        [row.minor_user_id, guardianUserId],
      );
      await client.query(
        `UPDATE guardian_invitations
         SET used_at = now(), accepted_by_user_id = $2, updated_at = now()
         WHERE id = $1`,
        [row.id, guardianUserId],
      );
      await client.query("COMMIT");
      return link.rows[0].id;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  test("convite de responsável só pode ser reivindicado por uma conta concorrente", async () => {
    const tokenDigest = "f".repeat(64);
    await pool.query(
      `INSERT INTO guardian_invitations(minor_user_id, token_digest, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [fixture.minor, tokenDigest],
    );
    const results = await Promise.all([
      acceptGuardianInvitation(tokenDigest, fixture.guardianOne),
      acceptGuardianInvitation(tokenDigest, fixture.guardianTwo),
    ]);
    assert.equal(results.filter((value) => value !== "unavailable").length, 1);
    assert.equal(results.filter((value) => value === "unavailable").length, 1);
    const invite = await pool.query(
      "SELECT accepted_by_user_id FROM guardian_invitations WHERE token_digest = $1",
      [tokenDigest],
    );
    assert.ok([fixture.guardianOne, fixture.guardianTwo].includes(invite.rows[0].accepted_by_user_id));
  });

  test("claims SKIP LOCKED não se sobrepõem e fencing rejeita worker antigo", async () => {
    // PostgreSQL keeps microseconds while JavaScript Date is millisecond-only.
    // A fixed eligible clock prevents setup precision from masquerading as a lost claim.
    const eligibleAt = new Date("2026-08-01T00:00:00.000Z");
    const now = new Date("2026-08-01T00:00:01.000Z");
    const inserted = await pool.query(
      `INSERT INTO outbox_events(
         aggregate_type, aggregate_id, event_type, payload, occurred_at, available_at
       )
       SELECT 'test', value::text, 'billing.restore_requested.v1', '{}'::jsonb, $1, $1
       FROM generate_series(1, 4) AS value RETURNING id`,
      [eligibleAt],
    );
    assert.equal(inserted.rowCount, 4);
    const options = {
      now,
      batchSize: 2,
      leaseMs: 60_000,
      maxAttempts: 5,
      eventTypes: ["billing.restore_requested.v1"],
    };
    const [first, second] = await Promise.all([repository.claimBatch(options), repository.claimBatch(options)]);
    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.equal(first.filter((event) => second.some((other) => other.id === event.id)).length, 0);
    const insertedIds = inserted.rows.map((row) => row.id).sort();
    const claimedIds = [...first, ...second].map((event) => event.id).sort();
    assert.deepEqual(claimedIds, insertedIds);

    const claimed = first[0];
    assert.equal(await repository.reschedule(claimed.id, claimed.attempts, new Date(now.getTime() - 1_000)), true);
    const reclaimed = await repository.claimBatch({ ...options, batchSize: 1, now: new Date(now.getTime() + 1) });
    assert.equal(reclaimed[0].id, claimed.id);
    assert.equal(reclaimed[0].attempts, claimed.attempts + 1);
    assert.equal(await repository.markProcessed(claimed.id, claimed.attempts, new Date()), false);
    assert.equal(await repository.markProcessed(reclaimed[0].id, reclaimed[0].attempts, new Date()), true);
  });

  test("worker finaliza deadline uma vez, reproduz hash e não altera mastery", async () => {
    const rules = {
      schemaVersion: "simulation-blueprint-rules.v1",
      questionCount: 1,
      durationMinutes: 1,
      scoring: {
        model: "weighted-sum.v1",
        rounding: { decimalPlaces: 2, mode: "half-away-from-zero" },
        aggregateFloor: { policy: "none" },
      },
      subjects: [{
        subjectId: "matematica",
        questionCount: 1,
        correctPoints: "1",
        weight: "1",
        incorrect: { policy: "zero" },
        unanswered: { policy: "zero" },
      }],
    };
    const blueprint = await pool.query(
      `INSERT INTO blueprint_versions(exam_version_id, version, status, rules)
       VALUES ($1, 2, 'published', $2::jsonb) RETURNING id`,
      [fixture.exam, JSON.stringify(rules)],
    );

    async function insertSimulation(id, startedAt) {
      const snapshot = createSimulationSnapshot({
        sessionId: id,
        blueprintVersionId: blueprint.rows[0].id,
        rules,
        startedAtMs: startedAt.getTime(),
        questions: [{
          questionVersionId: fixture.version,
          subjectId: "matematica",
          optionIds: fixture.optionIds,
          correctOptionId: fixture.correctOption,
        }],
      });
      const state = createSimulationState(snapshot);
      await pool.query(
        `INSERT INTO simulation_sessions(
           id, user_id, product_id, exam_version_id, blueprint_version_id,
           create_idempotency_key, rules, snapshot, snapshot_hash, state,
           started_at, deadline_at
         ) VALUES ($1, $2, 'eear', $3, $4, $5, $6::jsonb, $7::jsonb, $8,
                   $9::jsonb, $10, $11)`,
        [
          id, fixture.learner, fixture.exam, blueprint.rows[0].id,
          `simulation-worker-${id}`, JSON.stringify(rules), JSON.stringify(snapshot),
          snapshot.snapshotHash, JSON.stringify(state), startedAt, new Date(snapshot.deadlineAtMs),
        ],
      );
      await pool.query(
        `INSERT INTO simulation_questions(
           simulation_id, position, question_version_id, subject_id, option_ids, correct_option_id
         ) VALUES ($1, 0, $2, 'matematica', $3::uuid[], $4)`,
        [id, fixture.version, fixture.optionIds, fixture.correctOption],
      );
      return { snapshot, state };
    }

    const dbNow = await pool.query("SELECT clock_timestamp() AS now");
    const pastStartedAt = new Date(new Date(dbNow.rows[0].now).getTime() - 120_000);
    const pastId = "20000000-0000-4000-8000-000000000010";
    const past = await insertSimulation(pastId, pastStartedAt);
    const expectedState = finishSimulationAtTime(past.snapshot, past.state, past.snapshot.deadlineAtMs);
    const expectedResult = computeSimulationResult(past.snapshot, expectedState);
    const masteryBefore = await pool.query(
      "SELECT count(*)::int AS count FROM topic_mastery WHERE user_id = $1",
      [fixture.learner],
    );
    const finalizeInput = {
      simulationId: pastId,
      expectedDeadlineAt: new Date(past.snapshot.deadlineAtMs),
      eventId: "10000000-0000-4000-8000-000000000020",
    };
    const outcomes = await Promise.all([
      repository.finalizeSimulationDeadline(finalizeInput),
      repository.finalizeSimulationDeadline(finalizeInput),
    ]);
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["already_finalized", "finalized"]);
    assert.ok(outcomes.every((outcome) => outcome.status === "missing" || outcome.resultHash === expectedResult.resultHash));
    const stored = await pool.query(
      `SELECT status, state, result, result_hash, finalized_at, finish_reason
       FROM simulation_sessions WHERE id = $1`,
      [pastId],
    );
    assert.equal(stored.rows[0].status, "finalized");
    assert.equal(stored.rows[0].finish_reason, "deadline");
    assert.equal(stored.rows[0].result_hash, expectedResult.resultHash);
    assert.deepEqual(stored.rows[0].state, expectedState);
    assert.deepEqual(stored.rows[0].result, expectedResult);
    assert.equal(new Date(stored.rows[0].finalized_at).getTime(), past.snapshot.deadlineAtMs);
    const audits = await pool.query(
      `SELECT count(*)::int AS count FROM audit_logs
       WHERE resource_type = 'simulation' AND resource_id = $1
         AND action = 'simulation.finalized.deadline'`,
      [pastId],
    );
    assert.equal(audits.rows[0].count, 1);
    const masteryAfter = await pool.query(
      "SELECT count(*)::int AS count FROM topic_mastery WHERE user_id = $1",
      [fixture.learner],
    );
    assert.equal(masteryAfter.rows[0].count, masteryBefore.rows[0].count);

    const futureId = "20000000-0000-4000-8000-000000000011";
    const future = await insertSimulation(futureId, new Date(new Date(dbNow.rows[0].now).getTime() + 60_000));
    const notDue = await repository.finalizeSimulationDeadline({
      simulationId: futureId,
      expectedDeadlineAt: new Date(future.snapshot.deadlineAtMs),
      eventId: "10000000-0000-4000-8000-000000000021",
    });
    assert.equal(notDue.status, "not_due");
    assert.equal(notDue.deadlineAt.getTime(), future.snapshot.deadlineAtMs);
    await pool.query(
      `INSERT INTO simulation_answers(
         simulation_id, question_version_id, selected_option_id, idempotency_key, received_at
       ) VALUES ($1, $2, $3, 'relational-state-divergence', $4)`,
      [
        futureId,
        fixture.version,
        fixture.correctOption,
        new Date(future.snapshot.startedAtMs + 1_000),
      ],
    );
    assert.deepEqual(await repository.finalizeSimulationDeadline({
      simulationId: futureId,
      expectedDeadlineAt: new Date(future.snapshot.deadlineAtMs),
      eventId: "10000000-0000-4000-8000-000000000024",
    }), { status: "invalid", code: "simulation_state_invalid" });
    await pool.query("DELETE FROM simulation_sessions WHERE id = $1", [futureId]);

    const corruptResultId = "20000000-0000-4000-8000-000000000012";
    const corruptResultSession = await insertSimulation(
      corruptResultId,
      new Date(new Date(dbNow.rows[0].now).getTime() - 180_000),
    );
    const corruptFinalState = finishSimulationAtTime(
      corruptResultSession.snapshot,
      corruptResultSession.state,
      corruptResultSession.snapshot.deadlineAtMs,
    );
    const forgedHash = "f".repeat(64);
    await pool.query(
      `UPDATE simulation_sessions
       SET status = 'finalized', state = $2::jsonb,
           result = $3::jsonb, result_hash = $4,
           finalized_at = $5, finish_reason = 'deadline'
       WHERE id = $1`,
      [
        corruptResultId,
        JSON.stringify(corruptFinalState),
        JSON.stringify({ forged: true, resultHash: forgedHash }),
        forgedHash,
        new Date(corruptResultSession.snapshot.deadlineAtMs),
      ],
    );
    assert.deepEqual(await repository.finalizeSimulationDeadline({
      simulationId: corruptResultId,
      expectedDeadlineAt: new Date(corruptResultSession.snapshot.deadlineAtMs),
      eventId: "10000000-0000-4000-8000-000000000025",
    }), { status: "invalid", code: "simulation_result_invalid" });
    await pool.query("DELETE FROM simulation_sessions WHERE id = $1", [corruptResultId]);

    assert.deepEqual(await repository.finalizeSimulationDeadline({
      simulationId: "20000000-0000-4000-8000-000000000099",
      expectedDeadlineAt: new Date(future.snapshot.deadlineAtMs),
      eventId: "10000000-0000-4000-8000-000000000022",
    }), { status: "missing" });
    const corruptSnapshotId = "20000000-0000-4000-8000-000000000013";
    const corruptSnapshotDeadline = new Date(pastStartedAt.getTime() + 60_000);
    await pool.query(
      `INSERT INTO simulation_sessions(
         id, user_id, product_id, exam_version_id, blueprint_version_id,
         create_idempotency_key, rules, snapshot, snapshot_hash, state,
         started_at, deadline_at
       ) VALUES ($1, $2, 'eear', $3, $4, 'simulation-worker-corrupt-snapshot',
         $5::jsonb, '{}'::jsonb, $6, '{}'::jsonb, $7, $8)`,
      [
        corruptSnapshotId,
        fixture.learner,
        fixture.exam,
        blueprint.rows[0].id,
        JSON.stringify(rules),
        "9".repeat(64),
        pastStartedAt,
        corruptSnapshotDeadline,
      ],
    );
    const corrupt = await repository.finalizeSimulationDeadline({
      simulationId: corruptSnapshotId,
      expectedDeadlineAt: corruptSnapshotDeadline,
      eventId: "10000000-0000-4000-8000-000000000023",
    });
    assert.deepEqual(corrupt, { status: "invalid", code: "simulation_state_invalid" });
    await pool.query("DELETE FROM simulation_sessions WHERE id = $1", [corruptSnapshotId]);
  });

  test("reconciliação de entitlement é monotônica por data e event id", async () => {
    const base = {
      userId: fixture.learner,
      state: {
        active: true,
        entitlementKey: "pro",
        productSku: "iaaprova.pro.monthly",
        store: "APP_STORE",
        environment: "production",
        startsAt: new Date("2026-08-01T00:00:00Z"),
        expiresAt: new Date("2026-09-01T00:00:00Z"),
      },
    };
    await repository.reconcileProEntitlement({ ...base, eventId: "event-b", eventOccurredAt: new Date("2026-08-20T00:00:00Z") });
    await repository.reconcileProEntitlement({
      ...base,
      eventId: "event-z-old",
      eventOccurredAt: new Date("2026-08-19T00:00:00Z"),
      state: { ...base.state, active: false },
    });
    let current = await pool.query(
      "SELECT status, source_event_id FROM entitlements WHERE user_id = $1 AND key = 'pro'",
      [fixture.learner],
    );
    assert.deepEqual(current.rows[0], { status: "active", source_event_id: "event-b" });

    await repository.reconcileProEntitlement({
      ...base,
      eventId: "event-a",
      eventOccurredAt: new Date("2026-08-20T00:00:00Z"),
      state: { ...base.state, active: false },
    });
    current = await pool.query(
      "SELECT status, source_event_id FROM entitlements WHERE user_id = $1 AND key = 'pro'",
      [fixture.learner],
    );
    assert.deepEqual(current.rows[0], { status: "active", source_event_id: "event-b" });

    await repository.reconcileProEntitlement({
      ...base,
      eventId: "event-c",
      eventOccurredAt: new Date("2026-08-20T00:00:00Z"),
      state: { ...base.state, active: false },
    });
    current = await pool.query(
      "SELECT status, source_event_id FROM entitlements WHERE user_id = $1 AND key = 'pro'",
      [fixture.learner],
    );
    assert.deepEqual(current.rows[0], { status: "inactive", source_event_id: "event-c" });
  });

  test("questão referenciada e tentativa não podem ser reescritas; workflow e rollback continuam válidos", async () => {
    const attempt = await pool.query(
      `INSERT INTO attempts(
         user_id, session_id, exposure_id, question_version_id, selected_option_id,
         is_correct, elapsed_ms, valid_for_calibration, mastery_probability,
         mastery_observations, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, true, 1200, true, 0.6, 1, 'attempt-integration-1')
       RETURNING id`,
      [fixture.learner, fixture.session, fixture.exposure, fixture.version, fixture.correctOption],
    );
    await assertPostgresError(
      pool.query(
        `INSERT INTO attempts(
           user_id, session_id, exposure_id, question_version_id, selected_option_id,
           is_correct, elapsed_ms, valid_for_calibration, mastery_probability,
           mastery_observations, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, true, 900, true, 0.7, 2, 'attempt-other-key')`,
        [fixture.learner, fixture.session, fixture.exposure, fixture.version, fixture.correctOption],
      ),
      "23505",
    );
    const secondExposure = await pool.query(
      `INSERT INTO item_exposures(session_id, user_id, question_version_id, sequence, selection_bucket)
       VALUES ($1, $2, $3, 2, 'coverage') RETURNING id`,
      [fixture.session, fixture.learner, fixture.version],
    );
    await assertPostgresError(
      pool.query(
        `INSERT INTO attempts(
           user_id, session_id, exposure_id, question_version_id, selected_option_id,
           is_correct, elapsed_ms, valid_for_calibration, mastery_probability,
           mastery_observations, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, true, 900, true, 0.7, 2, 'attempt-integration-1')`,
        [fixture.learner, fixture.session, secondExposure.rows[0].id, fixture.version, fixture.correctOption],
      ),
      "23505",
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertPostgresError(
        client.query("UPDATE question_versions SET statement = 'adulterada' WHERE id = $1", [fixture.version]),
        "55000",
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const version = await pool.query("SELECT statement FROM question_versions WHERE id = $1", [fixture.version]);
    assert.equal(version.rows[0].statement, "Quanto é 2 + 2?");

    await pool.query("UPDATE question_versions SET status = 'suspended', updated_at = now() WHERE id = $1", [fixture.version]);
    const workflow = await pool.query("SELECT status FROM question_versions WHERE id = $1", [fixture.version]);
    assert.equal(workflow.rows[0].status, "suspended");

    await assertPostgresError(
      pool.query("UPDATE attempts SET is_correct = false WHERE id = $1", [attempt.rows[0].id]),
      "55000",
    );

    const unrelatedDraft = await pool.query(
      `INSERT INTO question_versions(
         question_item_id, version, exam_version_id, subject_id, topic_id,
         statement, solution, difficulty, skill, status, content_hash
       ) VALUES ($1, 99, $2, 'matematica', $3, 'Draft isolado', 'Solução', 'easy', 'resolver', 'quarantine', $4)
       RETURNING id`,
      [fixture.item, fixture.exam, fixture.topic, "9".repeat(64)],
    );
    await assertPostgresError(
      pool.query(
        "UPDATE question_options SET question_version_id = $2 WHERE id = $1",
        [fixture.correctOption, unrelatedDraft.rows[0].id],
      ),
      "55000",
    );

    const disposableUser = await createUser("clerk_test_disposable", "disposable@test.invalid");
    const disposableSession = await pool.query(
      `INSERT INTO learning_sessions(user_id, product_id, exam_version_id, mode, algorithm_version, seed)
       VALUES ($1, 'eear', $2, 'practice', 'bayes-v1', 'disposable') RETURNING id`,
      [disposableUser, fixture.exam],
    );
    await pool.query(
      `INSERT INTO item_exposures(session_id, user_id, question_version_id, sequence, selection_bucket)
       VALUES ($1, $2, $3, 1, 'coverage')`,
      [disposableSession.rows[0].id, disposableUser, unrelatedDraft.rows[0].id],
    );
    await pool.query("DELETE FROM users WHERE id = $1", [disposableUser]);
    await assertPostgresError(
      pool.query("UPDATE question_versions SET statement = 'reescrita após exclusão' WHERE id = $1", [unrelatedDraft.rows[0].id]),
      "55000",
    );

    const deletion = await pool.connect();
    try {
      await deletion.query("BEGIN");
      await deletion.query("DELETE FROM attempts WHERE id = $1", [attempt.rows[0].id]);
      await deletion.query("ROLLBACK");
    } finally {
      deletion.release();
    }
    const preserved = await pool.query("SELECT is_correct FROM attempts WHERE id = $1", [attempt.rows[0].id]);
    assert.equal(preserved.rows[0].is_correct, true);
  });
}
