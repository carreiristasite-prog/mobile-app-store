import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireSafeTestDatabaseTarget } from "./database-guard.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(HERE, "../migrations");

const MIGRATION_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const DESTRUCTIVE_SQL = /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE|ALTER\s+TABLE[\s\S]{0,160}?DROP\s+COLUMN)\b/i;
const EPHEMERAL_SCHEMA = /^ia_aprova_it_[a-z0-9_]+$/;

export async function discoverMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (names.length === 0) throw new Error("Nenhuma migration SQL encontrada");

  const migrations = [];
  for (const [index, name] of names.entries()) {
    const match = MIGRATION_NAME.exec(name);
    if (!match) throw new Error(`Nome de migration inválido: ${name}`);
    const expected = String(index + 1).padStart(4, "0");
    if (match[1] !== expected) {
      throw new Error(`Ordem de migrations inválida: esperado ${expected}, encontrado ${match[1]}`);
    }
    const hash = name.slice(0, -4);
    const sql = await readFile(path.join(directory, name), "utf8");
    const selfRegistration = new RegExp(
      `INSERT\\s+INTO\\s+[\"']?__drizzle_migrations__[\"']?[\\s\\S]+?VALUES\\s*\\(\\s*'${hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`,
      "i",
    );
    if (!selfRegistration.test(sql)) throw new Error(`${name} não registra o hash ${hash}`);
    if (DESTRUCTIVE_SQL.test(sql)) throw new Error(`${name} contém DDL destrutivo proibido pelo harness`);
    migrations.push({
      order: Number(match[1]),
      name,
      hash,
      sql,
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return migrations;
}

async function assertConnectedToGuardedDatabase(client, safety) {
  const result = await client.query("SELECT current_database() AS database, current_schema() AS schema");
  if (result.rows[0]?.database !== safety.database) {
    throw new Error("A conexão aberta não corresponde ao banco aprovado pelo guard");
  }
  if (!EPHEMERAL_SCHEMA.test(result.rows[0]?.schema ?? "")) {
    throw new Error("A conexão não está isolada em um schema efêmero ia_aprova_it_*");
  }
}

async function migrationTableExists(client) {
  const result = await client.query("SELECT to_regclass('__drizzle_migrations__')::text AS name");
  return result.rows[0]?.name !== null;
}

async function appliedHashes(client) {
  if (!(await migrationTableExists(client))) return new Set();
  const result = await client.query("SELECT hash FROM __drizzle_migrations__ ORDER BY id");
  return new Set(result.rows.map((row) => row.hash));
}

async function ensureChecksumTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS __ia_aprova_test_migration_checksums (
    hash text PRIMARY KEY,
    sha256 text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function recordedChecksums(client) {
  const result = await client.query("SELECT hash, sha256 FROM __ia_aprova_test_migration_checksums");
  return new Map(result.rows.map((row) => [row.hash, row.sha256]));
}

export function planMigrations(migrations, applied, checksums) {
  const byHash = new Map(migrations.map((migration) => [migration.hash, migration]));
  for (const hash of applied) {
    const migration = byHash.get(hash);
    if (!migration) throw new Error(`Migration aplicada não existe no diretório: ${hash}`);
    const recorded = checksums.get(hash);
    if (!recorded) throw new Error(`Migration aplicada não possui checksum confiável: ${migration.name}`);
    if (recorded !== migration.sha256) {
      throw new Error(`Checksum divergente para migration já aplicada: ${migration.name}`);
    }
  }
  for (const hash of checksums.keys()) {
    if (!applied.has(hash)) throw new Error(`Checksum órfão sem migration aplicada: ${hash}`);
  }
  return {
    toApply: migrations.filter((migration) => !applied.has(migration.hash)),
    skipped: migrations.filter((migration) => applied.has(migration.hash)).map((migration) => migration.hash),
  };
}

/** Apply each migration once, in lexical/numeric order, under a session lock. */
export async function applyMigrations(pool, safety, directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  requireSafeTestDatabaseTarget(safety);
  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    await assertConnectedToGuardedDatabase(client, safety);
    await client.query("SELECT pg_advisory_lock(hashtext('ia-aprova-test-migrations'))");
    await ensureChecksumTable(client);
    const plan = planMigrations(migrations, await appliedHashes(client), await recordedChecksums(client));
    skipped.push(...plan.skipped);
    for (const migration of plan.toApply) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        const verified = await appliedHashes(client);
        if (!verified.has(migration.hash)) {
          throw new Error(`Migration não registrou o próprio hash: ${migration.name}`);
        }
        await client.query(
          `INSERT INTO __ia_aprova_test_migration_checksums(hash, sha256)
           VALUES ($1, $2)`,
          [migration.hash, migration.sha256],
        );
        await client.query("COMMIT");
        applied.push(migration.hash);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return { applied, skipped, hashes: migrations.map((migration) => migration.hash) };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('ia-aprova-test-migrations'))").catch(() => undefined);
    client.release();
  }
}
