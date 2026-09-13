import assert from "node:assert/strict";
import test from "node:test";
import {
  UnsafeTestDatabaseError,
  assertSafeTestDatabaseUrl,
  isSafeTestDatabaseTarget,
  requireSafeTestDatabaseTarget,
} from "./database-guard.mjs";

test("aceita somente alvos locais/CI explicitamente nomeados para IA Aprova", () => {
  const local = assertSafeTestDatabaseUrl("postgresql://iaaprova_test:local@localhost:5432/ia_aprova_test");
  const service = assertSafeTestDatabaseUrl("postgres://iaaprova_ci:local@postgres:5432/ia_aprova_ci_pr42");
  const isolated = assertSafeTestDatabaseUrl("postgresql://runner:local@db-test.internal/iaaprova_testing_branch7?sslmode=require");
  const ipv6 = assertSafeTestDatabaseUrl("postgresql://runner:local@[::1]/ia_aprova_test");
  assert.equal(local.database, "ia_aprova_test");
  assert.equal(service.hostname, "postgres");
  assert.equal(isolated.database, "iaaprova_testing_branch7");
  assert.equal(ipv6.hostname, "[::1]");
  assert.equal(isSafeTestDatabaseTarget(local), true);
  assert.equal(requireSafeTestDatabaseTarget(local), local);
});

test("recusa ausência, protocolos e bancos que não sejam explicitamente de teste", () => {
  for (const value of [
    undefined,
    "",
    "mysql://runner:local@localhost/ia_aprova_test",
    "postgresql://runner:local@localhost/postgres",
    "postgresql://runner:local@localhost/ia_aprova",
    "postgresql://runner:local@localhost/test",
  ]) {
    assert.throws(() => assertSafeTestDatabaseUrl(value), UnsafeTestDatabaseError);
  }
});

test("recusa qualquer marcador de produção ou host remoto não isolado", () => {
  for (const value of [
    "postgresql://runner:local@db-prod.internal/ia_aprova_test",
    "postgresql://prod:local@localhost/ia_aprova_test",
    "postgresql://runner:local@db.example.com/ia_aprova_test",
    "postgresql://runner:local@localhost/ia_aprova_test_prod",
    "postgresql://runner:local@localhost/ia_aprova_test?options=-csearch_path%3Dpublic",
    "postgresql://runner:local@localhost/ia_aprova_test?host=db-prod.internal",
    "postgresql://runner:local@localhost/ia_aprova_test?user=prod",
    "postgresql://runner:local@localhost/ia_aprova_test?password=secret",
    "postgresql://runner:local@localhost/ia_aprova_test?port=6543",
    "postgresql://runner:local@localhost/ia_aprova_test?sslmode=disable",
    "postgresql://runner:local@localhost/ia_aprova_test?sslmode=require&sslmode=verify-full",
    "postgresql://p%72od:local@localhost/ia_aprova_test",
    "postgresql://runner:local@localhost/ia_aprova_test#ignored",
  ]) {
    assert.throws(() => assertSafeTestDatabaseUrl(value), UnsafeTestDatabaseError);
  }
});

test("runner exige o resultado opaco do guard", () => {
  assert.throws(() => requireSafeTestDatabaseTarget({ database: "ia_aprova_test" }), UnsafeTestDatabaseError);
});
