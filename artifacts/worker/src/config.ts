export const PRO_ENTITLEMENT_KEY = "pro" as const;
export const PRO_PRODUCT_SKUS = {
  APP_STORE: "iaaprova.pro.monthly",
  PLAY_STORE: "iaaprova.pro.monthly:monthly-auto-renewing",
} as const;

export interface RevenueCatConfig {
  secretApiKey: string;
  projectId: string;
  environment: "production" | "sandbox";
  timeoutMs: number;
}

export interface WorkerConfig {
  databaseUrl: string;
  healthPort: number;
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffJitterRatio: number;
  shutdownTimeoutMs: number;
  revenueCat: RevenueCatConfig | null;
  privacy: PrivacyConfig | null;
}

export interface RetentionRules {
  version: 1;
  auditLogsDays: number;
  riskEventsDays: number;
  subscriptionEventsDays: number;
  dataRequestsDays: number;
  backupSuppressionDays: number;
}

export interface PrivacyConfig {
  exportBucket: string;
  exportKmsKeyResource: string;
  exportTtlHours: number;
  timeoutMs: number;
  retentionPolicyId: string;
  retentionPolicySha256: string;
  retentionApprovedAt: Date;
  retentionApprovedBy: string;
  retentionRules: RetentionRules;
  clerkSecretKey: string;
}

function integer(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}`);
  }
  return value;
}

function ratio(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 0.5) {
    throw new Error(`${key} must be between 0 and 0.5`);
  }
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${key} must be true or false`);
}

function revenueCatConfig(env: NodeJS.ProcessEnv): RevenueCatConfig | null {
  const secretApiKey = env["REVENUECAT_SECRET_API_KEY"];
  const projectId = env["REVENUECAT_PROJECT_ID"];
  const revenueCatKeys = [
    "REVENUECAT_SECRET_API_KEY",
    "REVENUECAT_PROJECT_ID",
    "REVENUECAT_ENVIRONMENT",
    "REVENUECAT_TIMEOUT_MS",
  ];
  const configured = revenueCatKeys.filter((key) => env[key] !== undefined && env[key] !== "");

  if (configured.length > 0 && (!secretApiKey || !projectId)) {
    throw new Error("RevenueCat configuration is incomplete");
  }
  if (configured.length === 0) return null;

  if (!/^sk_[0-9A-Za-z_-]{13,}$/.test(secretApiKey ?? "")) {
    throw new Error("REVENUECAT_SECRET_API_KEY is invalid");
  }
  if (!/^proj[0-9A-Za-z_-]+$/.test(projectId ?? "")) {
    throw new Error("REVENUECAT_PROJECT_ID is invalid");
  }

  const environment = env["REVENUECAT_ENVIRONMENT"] ?? "production";
  if (environment !== "production" && environment !== "sandbox") {
    throw new Error("REVENUECAT_ENVIRONMENT must be production or sandbox");
  }
  if (env["NODE_ENV"] === "production" && environment !== "production") {
    throw new Error("Sandbox RevenueCat data cannot authorize production access");
  }

  return {
    secretApiKey: secretApiKey as string,
    projectId: projectId as string,
    environment,
    timeoutMs: integer(env, "REVENUECAT_TIMEOUT_MS", 5_000, 500, 30_000),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function privacyConfig(env: NodeJS.ProcessEnv): PrivacyConfig | null {
  const names = [
    "PRIVACY_EXPORT_BUCKET",
    "PRIVACY_EXPORT_BUCKET_ALLOWLIST",
    "PRIVACY_EXPORT_TTL_HOURS",
    "PRIVACY_TIMEOUT_MS",
    "PRIVACY_EXPORT_CMEK_CONFIRMED",
    "PRIVACY_EXPORT_LIFECYCLE_CONFIRMED",
    "PRIVACY_EXPORT_KMS_KEY_RESOURCE",
    "PRIVACY_RETENTION_POLICY_ID",
    "PRIVACY_RETENTION_POLICY_SHA256",
    "PRIVACY_RETENTION_APPROVED_AT",
    "PRIVACY_RETENTION_APPROVED_BY",
    "PRIVACY_RETENTION_RULES_JSON",
    "CLERK_SECRET_KEY",
  ];
  const configured = names.filter((name) => env[name] !== undefined && env[name] !== "");
  if (configured.length === 0) return null;
  if (configured.length !== names.length) throw new Error("Privacy processing configuration is incomplete");

  const exportBucket = env["PRIVACY_EXPORT_BUCKET"] as string;
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(exportBucket)) {
    throw new Error("PRIVACY_EXPORT_BUCKET is invalid");
  }
  const bucketAllowlist = new Set((env["PRIVACY_EXPORT_BUCKET_ALLOWLIST"] as string)
    .split(",").map((item) => item.trim()).filter(Boolean));
  if (!bucketAllowlist.has(exportBucket)) throw new Error("PRIVACY_EXPORT_BUCKET is not allowlisted");
  if (!booleanValue(env, "PRIVACY_EXPORT_CMEK_CONFIRMED", false)
      || !booleanValue(env, "PRIVACY_EXPORT_LIFECYCLE_CONFIRMED", false)) {
    throw new Error("Privacy export storage requires confirmed CMEK and lifecycle controls");
  }
  const exportKmsKeyResource = env["PRIVACY_EXPORT_KMS_KEY_RESOURCE"] as string;
  if (!/^projects\/[a-z0-9-]+\/locations\/southamerica-east1\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/.test(exportKmsKeyResource)) {
    throw new Error("PRIVACY_EXPORT_KMS_KEY_RESOURCE is invalid");
  }

  const retentionPolicyId = env["PRIVACY_RETENTION_POLICY_ID"] as string;
  const retentionPolicySha256 = env["PRIVACY_RETENTION_POLICY_SHA256"] as string;
  const retentionApprovedBy = env["PRIVACY_RETENTION_APPROVED_BY"] as string;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(retentionPolicyId)) {
    throw new Error("PRIVACY_RETENTION_POLICY_ID is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(retentionPolicySha256)) {
    throw new Error("PRIVACY_RETENTION_POLICY_SHA256 is invalid");
  }
  if (retentionApprovedBy.trim().length < 3 || retentionApprovedBy.length > 160) {
    throw new Error("PRIVACY_RETENTION_APPROVED_BY is invalid");
  }
  const retentionApprovedAt = new Date(env["PRIVACY_RETENTION_APPROVED_AT"] as string);
  if (Number.isNaN(retentionApprovedAt.getTime()) || retentionApprovedAt.getTime() > Date.now()) {
    throw new Error("PRIVACY_RETENTION_APPROVED_AT is invalid");
  }

  let rules: unknown;
  try { rules = JSON.parse(env["PRIVACY_RETENTION_RULES_JSON"] as string) as unknown; } catch {
    throw new Error("PRIVACY_RETENTION_RULES_JSON is invalid JSON");
  }
  if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
    throw new Error("PRIVACY_RETENTION_RULES_JSON is invalid");
  }
  const record = rules as Record<string, unknown>;
  const expectedKeys = [
    "auditLogsDays", "backupSuppressionDays", "dataRequestsDays",
    "riskEventsDays", "subscriptionEventsDays", "version",
  ];
  if (Object.keys(record).sort().join(",") !== expectedKeys.sort().join(",") || record["version"] !== 1) {
    throw new Error("PRIVACY_RETENTION_RULES_JSON has an unsupported shape");
  }
  for (const key of expectedKeys.filter((key) => key !== "version")) {
    const value = record[key];
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3_650) {
      throw new Error(`PRIVACY_RETENTION_RULES_JSON.${key} is invalid`);
    }
  }
  const actualHash = createHash("sha256").update(canonical(record), "utf8").digest("hex");
  if (actualHash !== retentionPolicySha256) {
    throw new Error("PRIVACY_RETENTION_POLICY_SHA256 does not match the canonical rules");
  }

  const clerkSecretKey = env["CLERK_SECRET_KEY"] as string;
  if (!/^sk_(test|live)_[0-9A-Za-z_-]{16,}$/.test(clerkSecretKey)) {
    throw new Error("CLERK_SECRET_KEY is invalid");
  }
  if (env["NODE_ENV"] === "production" && !clerkSecretKey.startsWith("sk_live_")) {
    throw new Error("A live Clerk key is required in production");
  }
  return {
    exportBucket,
    exportKmsKeyResource,
    exportTtlHours: integer(env, "PRIVACY_EXPORT_TTL_HOURS", 24, 1, 168),
    timeoutMs: integer(env, "PRIVACY_TIMEOUT_MS", 10_000, 500, 60_000),
    retentionPolicyId,
    retentionPolicySha256,
    retentionApprovedAt,
    retentionApprovedBy,
    retentionRules: record as unknown as RetentionRules,
    clerkSecretKey,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env["DATABASE_URL"];
  let parsedDatabaseUrl: URL | null = null;
  try {
    parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
  } catch {
    parsedDatabaseUrl = null;
  }
  if (
    !databaseUrl
    || !parsedDatabaseUrl
    || (parsedDatabaseUrl.protocol !== "postgres:" && parsedDatabaseUrl.protocol !== "postgresql:")
    || !parsedDatabaseUrl.hostname
    || parsedDatabaseUrl.pathname.length < 2
  ) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }

  const revenueCat = revenueCatConfig(env);
  const privacy = privacyConfig(env);
  const requireRevenueCat = booleanValue(
    env,
    "WORKER_REQUIRE_REVENUECAT",
    env["NODE_ENV"] === "production",
  );
  if (requireRevenueCat && revenueCat === null) {
    throw new Error("RevenueCat is required but its server-side configuration is missing");
  }
  const privacyFlag = booleanValue(env, "WORKER_REQUIRE_PRIVACY", env["NODE_ENV"] === "production");
  if (env["NODE_ENV"] === "production" && !privacyFlag) {
    throw new Error("Privacy processing cannot be disabled in production");
  }
  const requirePrivacy = env["NODE_ENV"] === "production" || privacyFlag;
  if (requirePrivacy && (privacy === null || revenueCat === null)) {
    throw new Error("Privacy processing is required but retention, Clerk, GCS or RevenueCat configuration is missing");
  }

  const leaseMs = integer(env, "WORKER_LEASE_MS", 60_000, 5_000, 900_000);
  const backoffBaseMs = integer(env, "WORKER_BACKOFF_BASE_MS", 2_000, 100, 3_600_000);
  const backoffMaxMs = integer(env, "WORKER_BACKOFF_MAX_MS", 900_000, 1_000, 86_400_000);
  if (backoffMaxMs < backoffBaseMs) {
    throw new Error("WORKER_BACKOFF_MAX_MS must be at least WORKER_BACKOFF_BASE_MS");
  }

  return {
    databaseUrl,
    healthPort: integer(env, "PORT", 8081, 1, 65_535),
    pollIntervalMs: integer(env, "WORKER_POLL_INTERVAL_MS", 1_000, 100, 60_000),
    batchSize: integer(env, "WORKER_BATCH_SIZE", 20, 1, 100),
    leaseMs,
    maxAttempts: integer(env, "WORKER_MAX_ATTEMPTS", 12, 1, 50),
    backoffBaseMs,
    backoffMaxMs,
    backoffJitterRatio: ratio(env, "WORKER_BACKOFF_JITTER_RATIO", 0.2),
    shutdownTimeoutMs: integer(env, "WORKER_SHUTDOWN_TIMEOUT_MS", 30_000, 1_000, 120_000),
    revenueCat,
    privacy,
  };
}
import { createHash } from "node:crypto";
