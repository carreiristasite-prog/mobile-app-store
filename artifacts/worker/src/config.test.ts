import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadConfig } from "./config.ts";

const database = "postgresql://worker:password@database.example/ia_aprova";
const retentionRules = JSON.stringify({
  auditLogsDays: 365,
  backupSuppressionDays: 30,
  dataRequestsDays: 365,
  riskEventsDays: 365,
  subscriptionEventsDays: 365,
  version: 1,
});
const retentionHash = createHash("sha256").update(retentionRules).digest("hex");

test("production fails closed without RevenueCat server credentials", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: database, NODE_ENV: "production" }), /RevenueCat is required/);
});

test("partial RevenueCat configuration and public SDK keys are rejected", () => {
  assert.throws(() => loadConfig({
    DATABASE_URL: database,
    REVENUECAT_ENVIRONMENT: "production",
  }), /configuration is incomplete/);
  assert.throws(() => loadConfig({
    DATABASE_URL: database,
    REVENUECAT_PROJECT_ID: "proj123456",
    REVENUECAT_SECRET_API_KEY: "goog_public_key_not_secret",
  }), /SECRET_API_KEY is invalid/);
});

test("a v2 secret key and production project produce bounded defaults", () => {
  const config = loadConfig({
    DATABASE_URL: database,
    REVENUECAT_PROJECT_ID: "proj123456",
    REVENUECAT_SECRET_API_KEY: "sk_1234567890abcdef",
    WORKER_REQUIRE_PRIVACY: "false",
  });
  assert.equal(config.revenueCat?.environment, "production");
  assert.equal(config.maxAttempts, 12);
  assert.equal(config.leaseMs, 60_000);
});

test("malformed database and unsafe sandbox production settings are rejected", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: "postgresql:///missing-host" }), /DATABASE_URL/);
  assert.throws(() => loadConfig({
    DATABASE_URL: database,
    NODE_ENV: "production",
    REVENUECAT_PROJECT_ID: "proj123456",
    REVENUECAT_SECRET_API_KEY: "sk_1234567890abcdef",
    REVENUECAT_ENVIRONMENT: "sandbox",
    WORKER_REQUIRE_PRIVACY: "false",
  }), /Sandbox RevenueCat data/);
});

test("privacy remains disabled outside production unless every reviewed input is present", () => {
  const config = loadConfig({ DATABASE_URL: database, WORKER_REQUIRE_REVENUECAT: "false" });
  assert.equal(config.privacy, null);
  assert.throws(() => loadConfig({
    DATABASE_URL: database,
    PRIVACY_EXPORT_BUCKET: "private-dsr-bucket",
  }), /configuration is incomplete/);
});

test("production cannot bypass the privacy startup gate", () => {
  assert.throws(() => loadConfig({
    DATABASE_URL: database,
    NODE_ENV: "production",
    WORKER_REQUIRE_REVENUECAT: "false",
    WORKER_REQUIRE_PRIVACY: "false",
  }), /cannot be disabled in production/);
});

test("privacy configuration verifies bucket allowlist and canonical retention hash", () => {
  const base = {
    DATABASE_URL: database,
    WORKER_REQUIRE_REVENUECAT: "false",
    PRIVACY_EXPORT_BUCKET: "private-dsr-bucket",
    PRIVACY_EXPORT_BUCKET_ALLOWLIST: "private-dsr-bucket",
    PRIVACY_EXPORT_TTL_HOURS: "24",
    PRIVACY_TIMEOUT_MS: "5000",
    PRIVACY_EXPORT_CMEK_CONFIRMED: "true",
    PRIVACY_EXPORT_LIFECYCLE_CONFIRMED: "true",
    PRIVACY_EXPORT_KMS_KEY_RESOURCE: "projects/ia-aprova-prod/locations/southamerica-east1/keyRings/app/cryptoKeys/storage",
    PRIVACY_RETENTION_POLICY_ID: "privacy-policy-2026-08",
    PRIVACY_RETENTION_POLICY_SHA256: retentionHash,
    PRIVACY_RETENTION_APPROVED_AT: "2026-08-20T00:00:00.000Z",
    PRIVACY_RETENTION_APPROVED_BY: "external-legal-signoff-reference",
    PRIVACY_RETENTION_RULES_JSON: retentionRules,
    CLERK_SECRET_KEY: "sk_test_1234567890abcdefghij",
  };
  assert.equal(loadConfig(base).privacy?.retentionPolicySha256, retentionHash);
  assert.throws(() => loadConfig({ ...base, PRIVACY_EXPORT_BUCKET_ALLOWLIST: "another-bucket" }), /not allowlisted/);
  assert.throws(() => loadConfig({ ...base, PRIVACY_EXPORT_LIFECYCLE_CONFIRMED: "false" }), /confirmed CMEK and lifecycle/);
  assert.throws(() => loadConfig({ ...base, PRIVACY_RETENTION_POLICY_SHA256: "a".repeat(64) }), /does not match/);
});
