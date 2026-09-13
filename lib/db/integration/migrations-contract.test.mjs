import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { discoverMigrations, planMigrations } from "./migrations.mjs";

function sqlFreezeContract(source) {
  const tableMatch = source.match(
    /CREATE TABLE IF NOT EXISTS question_version_freezes\s*\(([\s\S]*?)\n\);/,
  );
  assert.ok(tableMatch, "migration 0006 precisa criar question_version_freezes");

  const body = tableMatch[1];
  const line = (columnName) => {
    const match = body.match(new RegExp(`^\\s*${columnName}\\s+(.+?)(?:,)?$`, "m"));
    assert.ok(match, `migration 0006 precisa declarar ${columnName}`);
    return match[1].replace(/,$/, "").trim();
  };
  const questionVersionId = line("question_version_id");
  const firstReferencedAt = line("first_referenced_at");
  const reason = line("reason");
  const sqlColumns = [...body.matchAll(/^\s*[a-z][a-z0-9_]*\s+(?:uuid|timestamptz|text)\b/gm)]
    .map((match) => match[0].trim().split(/\s+/)[0]);

  return {
    table: "question_version_freezes",
    columns: sqlColumns,
    questionVersionId: {
      type: /^uuid\b/i.test(questionVersionId) ? "uuid" : "other",
      notNull: /\b(?:NOT NULL|PRIMARY KEY)\b/i.test(questionVersionId),
      primaryKey: /\bPRIMARY KEY\b/i.test(questionVersionId),
      references: /REFERENCES\s+question_versions\s*\(\s*id\s*\)/i.test(questionVersionId)
        ? "question_versions.id"
        : null,
      onDelete: /ON DELETE\s+(CASCADE|RESTRICT|SET NULL|NO ACTION)/i.exec(questionVersionId)?.[1]?.toLowerCase()
        ?? "no action",
      default: null,
    },
    firstReferencedAt: {
      type: /^timestamptz\b/i.test(firstReferencedAt) ? "timestamptz" : "other",
      notNull: /\bNOT NULL\b/i.test(firstReferencedAt),
      primaryKey: false,
      references: null,
      onDelete: null,
      default: /\bDEFAULT\s+now\(\)/i.test(firstReferencedAt) ? "now()" : null,
    },
    reason: {
      type: /^text\b/i.test(reason) ? "text" : "other",
      notNull: /\bNOT NULL\b/i.test(reason),
      primaryKey: false,
      references: null,
      onDelete: null,
      default: /\bDEFAULT\s+'([^']+)'/i.exec(reason)?.[1] ?? null,
    },
    secondaryIndexes: [
      ...source.matchAll(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+question_version_freezes\b/gi,
      ),
    ].length,
  };
}

function drizzleFreezeContract(source) {
  const start = source.indexOf(
    'export const questionVersionFreezesTable = pgTable("question_version_freezes"',
  );
  assert.notEqual(start, -1, "schema Drizzle precisa exportar questionVersionFreezesTable");
  const nextExport = source.indexOf("\n\nexport const ", start + 1);
  const block = source.slice(start, nextExport === -1 ? source.length : nextExport);
  const field = (propertyName, nextPropertyName) => {
    const startMatch = new RegExp(`^\\s*${propertyName}:\\s*`, "m").exec(block);
    assert.ok(startMatch, `schema Drizzle precisa declarar ${propertyName}`);
    const valueStart = startMatch.index + startMatch[0].length;
    const tail = block.slice(valueStart);
    const endMatch = nextPropertyName
      ? new RegExp(`^\\s*${nextPropertyName}:\\s*`, "m").exec(tail)
      : /^\s*\}\);/m.exec(tail);
    assert.ok(endMatch, `schema Drizzle precisa delimitar ${propertyName}`);
    return tail.slice(0, endMatch.index).replace(/,\s*$/, "").trim();
  };
  const questionVersionId = field("questionVersionId", "firstReferencedAt");
  const firstReferencedAt = field("firstReferencedAt", "reason");
  const reason = field("reason");
  const drizzleColumns = [...block.matchAll(/(?:uuid|timestamp|text)\("([a-z][a-z0-9_]*)"/g)]
    .map((match) => match[1]);
  const defaultValue = (value) => {
    if (/\.defaultNow\(\)/.test(value)) return "now()";
    return /\.default\("([^"]+)"\)/.exec(value)?.[1] ?? null;
  };

  return {
    table: "question_version_freezes",
    columns: drizzleColumns,
    questionVersionId: {
      type: /^uuid\("question_version_id"\)/.test(questionVersionId) ? "uuid" : "other",
      notNull: /\.primaryKey\(\)|\.notNull\(\)/.test(questionVersionId),
      primaryKey: /\.primaryKey\(\)/.test(questionVersionId),
      references: /\.references\(\(\) => questionVersionsTable\.id\)/.test(questionVersionId)
        ? "question_versions.id"
        : null,
      onDelete: /onDelete:\s*"([^"]+)"/.exec(questionVersionId)?.[1] ?? "no action",
      default: defaultValue(questionVersionId),
    },
    firstReferencedAt: {
      type: /^timestamp\("first_referenced_at",\s*\{\s*withTimezone:\s*true\s*\}\)/.test(firstReferencedAt)
        ? "timestamptz"
        : "other",
      notNull: /\.notNull\(\)/.test(firstReferencedAt),
      primaryKey: false,
      references: null,
      onDelete: null,
      default: defaultValue(firstReferencedAt),
    },
    reason: {
      type: /^text\("reason"\)/.test(reason) ? "text" : "other",
      notNull: /\.notNull\(\)/.test(reason),
      primaryKey: false,
      references: null,
      onDelete: null,
      default: defaultValue(reason),
    },
    secondaryIndexes: /\b(?:index|uniqueIndex)\(/.test(block) ? 1 : 0,
  };
}

test("migrations são contíguas, aditivas, autorregistradas e possuem checksum", async () => {
  const migrations = await discoverMigrations();
  assert.ok(migrations.length >= 6);
  assert.deepEqual(
    migrations.map((migration) => migration.order),
    Array.from({ length: migrations.length }, (_, index) => index + 1),
  );
  for (const migration of migrations) {
    assert.match(migration.hash, /^\d{4}_[a-z0-9_]+$/);
    assert.match(migration.sha256, /^[a-f0-9]{64}$/);
  }
});

test("planejamento falha antes de aplicar quando histórico/checksum não é confiável", async () => {
  const migrations = await discoverMigrations();
  const first = migrations[0];
  const second = migrations[1];

  assert.throws(
    () => planMigrations(migrations, new Set([first.hash]), new Map()),
    /não possui checksum confiável/,
  );
  assert.throws(
    () => planMigrations(migrations, new Set([first.hash]), new Map([[first.hash, "0".repeat(64)]])),
    /Checksum divergente/,
  );
  assert.throws(
    () => planMigrations(migrations, new Set(["0000_desconhecida"]), new Map([["0000_desconhecida", "0".repeat(64)]])),
    /não existe no diretório/,
  );
  assert.throws(
    () => planMigrations(migrations, new Set(), new Map([[first.hash, first.sha256]])),
    /Checksum órfão/,
  );

  const plan = planMigrations(migrations, new Set([first.hash]), new Map([[first.hash, first.sha256]]));
  assert.deepEqual(plan.skipped, [first.hash]);
  assert.equal(plan.toApply[0].hash, second.hash);
});

test("question_version_freezes permanece alinhada entre migration 0006 e Drizzle", async () => {
  const [migration, schema] = await Promise.all([
    readFile(new URL("../migrations/0006_database_runtime_invariants.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/schema/platform.ts", import.meta.url), "utf8"),
  ]);

  const expected = {
    table: "question_version_freezes",
    columns: ["question_version_id", "first_referenced_at", "reason"],
    questionVersionId: {
      type: "uuid",
      notNull: true,
      primaryKey: true,
      references: "question_versions.id",
      onDelete: "no action",
      default: null,
    },
    firstReferencedAt: {
      type: "timestamptz",
      notNull: true,
      primaryKey: false,
      references: null,
      onDelete: null,
      default: "now()",
    },
    reason: {
      type: "text",
      notNull: true,
      primaryKey: false,
      references: null,
      onDelete: null,
      default: "publication_or_exposure",
    },
    secondaryIndexes: 0,
  };
  const migrationContract = sqlFreezeContract(migration);
  const drizzleContract = drizzleFreezeContract(schema);

  assert.deepEqual(migrationContract, expected);
  assert.deepEqual(drizzleContract, migrationContract);
});

test("guard de freezes detecta índice criado de forma idempotente", async () => {
  const migration = await readFile(
    new URL("../migrations/0006_database_runtime_invariants.sql", import.meta.url),
    "utf8",
  );

  const withUnexpectedIndex = `${migration}\nCREATE INDEX IF NOT EXISTS idx_freeze_reason\n  ON question_version_freezes(reason);\n`;
  assert.equal(sqlFreezeContract(withUnexpectedIndex).secondaryIndexes, 1);
});

test("guardian invitation replay binding permanece alinhado entre migration 0007 e Drizzle", async () => {
  const [migration, schema] = await Promise.all([
    readFile(new URL("../migrations/0007_guardian_invitation_replay_binding.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/schema/platform.ts", import.meta.url), "utf8"),
  ]);

  for (const column of ["guardian_link_id", "acceptance_request_hash"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    assert.match(schema, new RegExp(`\\("${column}"\\)`));
  }
  assert.match(migration, /ck_guardian_invitation_acceptance_binding/);
  assert.match(schema, /ck_guardian_invitation_acceptance_binding/);
  assert.match(migration, /acceptance_request_hash ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(schema, /acceptanceRequestHash} ~ '\^\[a-f0-9\]\{64\}\$'/);
});

test("DSR completion e evidência falham fechados na migration 0008", async () => {
  const migration = await readFile(
    new URL("../migrations/0008_privacy_dsr_state_machine.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /BEFORE INSERT OR UPDATE ON data_requests/);
  for (const step of [
    "export_stored",
    "access_revoked",
    "external_accounts_erased",
    "internal_data_erased",
    "completed",
  ]) {
    assert.match(migration, new RegExp(`e\\.step = '${step}'`));
  }
  assert.match(migration, /BEFORE UPDATE ON data_request_evidence/);
  assert.match(migration, /AFTER DELETE ON data_request_evidence[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /VALUES \('0008_privacy_dsr_state_machine', CURRENT_TIMESTAMP\)/);
});

test("entrega DSR fixa geração, audita acesso e exige revogação na migration 0009", async () => {
  const [migration, schema] = await Promise.all([
    readFile(new URL("../migrations/0009_privacy_export_delivery.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/schema/platform.ts", import.meta.url), "utf8"),
  ]);
  const aligned = new Map([
    ["export_object_generation", "exportObjectGeneration"],
    ["export_revoked_at", "exportRevokedAt"],
    ["data_request_export_access_events", "dataRequestExportAccessEventsTable"],
    ["export_objects_revoked", "export_objects_revoked"],
    ["expired_denied", "expired_denied"],
  ]);
  for (const [migrationToken, schemaToken] of aligned) {
    assert.match(migration, new RegExp(migrationToken));
    assert.match(schema, new RegExp(schemaToken));
  }
  assert.match(migration, /export_object_generation ~ '\^\[0-9\]\+\$'/);
  assert.match(migration, /BEFORE UPDATE ON data_request_export_access_events/);
  assert.match(migration, /AFTER DELETE ON data_request_export_access_events[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /NEW\.export_object_generation IS NULL AND NEW\.export_revoked_at IS NULL/);
  assert.match(migration, /export_revocation_required = false[\s\S]*kind = 'deletion' AND status = 'completed'/);
  assert.match(migration, /kind = 'export' AND status = 'completed'[\s\S]*export_object_generation IS NULL/);
  assert.match(migration, /e\.step = 'export_objects_revoked'/);
  assert.match(migration, /VALUES \('0009_privacy_export_delivery', CURRENT_TIMESTAMP\)/);
});

test("sinais etários da loja são minimizados e monitoring-only na migration 0010", async () => {
  const migration = await readFile(
    new URL("../migrations/0010_platform_age_signals.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS platform_age_signals/);
  assert.match(migration, /trust_status text NOT NULL DEFAULT 'device_reported_monitoring'/);
  assert.match(migration, /PRIMARY KEY\(user_id, platform\)/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /VALUES \('0010_platform_age_signals', CURRENT_TIMESTAMP\)/);
  assert.doesNotMatch(migration, /date_of_birth|birth_date|\bdob\b|install_id/i);
});

test("simulados 0011 persistem snapshot imutável e primeira resposta com constraints", async () => {
  const [migration, schema] = await Promise.all([
    readFile(new URL("../migrations/0011_simulation_sessions.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/schema/platform.ts", import.meta.url), "utf8"),
  ]);
  for (const table of ["simulation_sessions", "simulation_questions", "simulation_answers"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const invariant of [
    "uq_simulation_create_idempotency",
    "uq_simulation_first_answer",
    "uq_simulation_answer_idempotency",
    "simulation_answers_question_fkey",
    "simulation_snapshot_is_immutable",
    "simulation_answer_is_immutable",
    "simulation_answer_option_invalid",
  ]) {
    assert.match(migration, new RegExp(invariant));
  }
  assert.match(migration, /correct_option_id = ANY\(option_ids\)/);
  assert.match(migration, /VALUES \('0011_simulation_sessions', CURRENT_TIMESTAMP\)/);
  for (const drizzleExport of ["simulationSessionsTable", "simulationQuestionsTable", "simulationAnswersTable"]) {
    assert.match(schema, new RegExp(`export const ${drizzleExport}`));
  }
});

test("simulados 0012 recusam sessões ativas ocultas para a mesma conta", async () => {
  const compact = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const migration = compact(await readFile(
    new URL("../migrations/0012_simulation_single_active.sql", import.meta.url),
    "utf8",
  ));
  assert.match(migration, /having count\(\*\) > 1/);
  assert.match(migration, /raise exception 'simulation_multiple_active_sessions_require_adjudication'/);
  assert.match(migration, /create unique index if not exists uq_simulation_one_active_user[\s\S]*where status = 'active'/);
  assert.match(migration, /values \('0012_simulation_single_active', current_timestamp\)/);
  const schema = compact(await readFile(new URL("../src/schema/platform.ts", import.meta.url), "utf8"));
  assert.match(schema, /uniqueindex\("uq_simulation_one_active_user"\)\.on\(table\.userid\)\.where/);
});

test("simulados 0013 deixam legado bloqueado e exigem metadados editoriais explícitos", async () => {
  const compact = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const migration = compact(await readFile(
    new URL("../migrations/0013_simulation_editorial_eligibility.sql", import.meta.url),
    "utf8",
  ));
  assert.match(migration, /add column if not exists permissions jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /add column if not exists author_id text/);
  assert.match(migration, /add column if not exists source_transformation text/);
  assert.match(migration, /presentation_kind text not null default 'blocked_unclassified'/);
  assert.match(migration, /values \('0013_simulation_editorial_eligibility', current_timestamp\)/);
});

test("App Integrity 0014 é ownership-scoped, replay-safe e monitoring-only na Fase A", async () => {
  const [migration, schema, worker] = await Promise.all([
    readFile(new URL("../migrations/0014_app_integrity_phase_a.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/schema/platform.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../artifacts/worker/src/repository.ts", import.meta.url), "utf8"),
  ]);
  for (const table of [
    "integrity_device_bindings",
    "app_integrity_keys",
    "integrity_challenges",
    "integrity_verifications",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const invariant of [
    "integrity_challenges_owner_device_fkey",
    "integrity_verifications_owner_challenge_fkey",
    "uq_integrity_challenge_proof_digest",
    "uq_integrity_verification_owner_idempotency",
    "protect_integrity_challenge_binding",
    "protect_integrity_verification_binding",
    "trg_phase_a_platform_age_monitoring_only",
    "server_verified_is_disabled_in_app_integrity_phase_a",
  ]) {
    assert.match(migration, new RegExp(invariant));
  }
  assert.match(migration, /proof_delete_at <= reserved_at \+ interval '5 minutes'/);
  assert.match(migration, /lease_generation integer NOT NULL DEFAULT 0 CHECK\(lease_generation >= 0\)/);
  assert.match(migration, /VALUES \('0014_app_integrity_phase_a', CURRENT_TIMESTAMP\)/);
  assert.doesNotMatch(migration, /date_of_birth|birth_date|\bdob\b|play_age_install_id/i);
  for (const drizzleExport of [
    "integrityDeviceBindingsTable",
    "appIntegrityKeysTable",
    "integrityChallengesTable",
    "integrityVerificationsTable",
  ]) {
    assert.match(schema, new RegExp(`export const ${drizzleExport}`));
  }

  const exportMethod = worker.slice(
    worker.indexOf("async buildUserExportSnapshot"),
    worker.indexOf("async recordDataRequestStep"),
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
});
