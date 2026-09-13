import crypto from "k6/crypto";

const TARGETS = new Set(["health", "catalog", "auth_read", "learning_idempotency"]);
const RPS_PROFILES = new Set(["rps_300_1h", "rps_600_15m", "rps_1000_60s"]);
const AUTH_READ_PATHS = new Set([
  "/api/v1/me/onboarding-state",
  "/api/v1/me/home",
  "/api/v1/me/progress",
  "/api/v1/billing/entitlement",
]);
const HARD_BLOCKED_HOSTS = new Set([
  "iaaprova.com.br",
  "www.iaaprova.com.br",
  "api.iaaprova.com.br",
  "prod.iaaprova.com.br",
  "production.iaaprova.com.br",
]);
const DATASET_KEYS = new Set(["schemaVersion", "synthetic", "environment", "seedId", "users"]);
const DATASET_USER_KEYS = new Set(["alias", "accessToken", "tokenExpiresAt", "productId", "examVersionId", "mode"]);
const AUTHORIZATION_KEYS = new Set([
  "schemaVersion", "environment", "authorizationId", "testRunId", "baseUrl", "profile", "target",
  "datasetSha256", "mutationScope", "validFrom", "expiresAt",
]);
const EXPECTED_PROFILES = {
  rps_300_1h: { executor: "constant-arrival-rate", rate: 300, timeUnit: "1s", duration: "1h", preAllocatedVUs: 600, maxVUs: 2400 },
  rps_600_15m: { executor: "constant-arrival-rate", rate: 600, timeUnit: "1s", duration: "15m", preAllocatedVUs: 1200, maxVUs: 4800 },
  rps_1000_60s: { executor: "constant-arrival-rate", rate: 1000, timeUnit: "1s", duration: "60s", preAllocatedVUs: 2000, maxVUs: 8000 },
  sessions_5000: { executor: "per-vu-iterations", vus: 5000, iterations: 1, maxDuration: "30m" },
};
const EXPECTED_ITERATIONS = { rps_300_1h: 1080000, rps_600_15m: 540000, rps_1000_60s: 60000, sessions_5000: 5000 };

function required(name) {
  const value = (__ENV[name] || "").trim();
  if (!value) throw new Error(`Safety gate: ${name} is required.`);
  return value;
}

function exactTrue(name) {
  return (__ENV[name] || "") === "true";
}

function assertSafeRunId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/.test(value)) {
    throw new Error("Safety gate: TEST_RUN_ID must contain 8-64 safe characters.");
  }
}

function assertStagingBaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new Error("Safety gate: BASE_URL must be a valid absolute URL.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (parsed.protocol !== "https:") throw new Error("Safety gate: BASE_URL must use HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Safety gate: BASE_URL cannot contain credentials, query or fragment.");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("Safety gate: BASE_URL cannot contain a path.");
  }
  if (parsed.port && parsed.port !== "443") throw new Error("Safety gate: BASE_URL only accepts the standard HTTPS port.");
  if (HARD_BLOCKED_HOSTS.has(hostname) || /(^|[.-])(prod|production)([.-]|$)/.test(hostname)) {
    throw new Error("Safety gate: a production hostname is permanently blocked.");
  }

  const allowlist = required("STAGING_HOST_ALLOWLIST")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\.+$/, ""))
    .filter(Boolean);
  if (!allowlist.includes(hostname)) {
    throw new Error("Safety gate: BASE_URL hostname is not in STAGING_HOST_ALLOWLIST.");
  }

  const looksLikeStaging = /(^|[.-])(stage|staging|perf|loadtest)([.-]|$)/.test(hostname) || hostname.endsWith(".test");
  if (!looksLikeStaging) throw new Error("Safety gate: hostname does not identify a staging/performance environment.");
  if (hostname.endsWith(".iaaprova.com.br") && !exactTrue("ALLOW_IAAPROVA_STAGING_SUBDOMAIN")) {
    throw new Error("Safety gate: iaaprova.com.br subdomains are blocked by default; the staging-only override is required.");
  }
  return `${parsed.protocol}//${hostname}`;
}

function assertExactKeys(value, allowed, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Safety gate: ${path} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Safety gate: unexpected field is forbidden at ${path}.${key}.`);
  }
}

function readHashedJson(pathVariable, hashVariable, label) {
  const inputPath = required(pathVariable);
  const expectedHash = required(hashVariable).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`Safety gate: ${hashVariable} must be a SHA-256 hex digest.`);
  const raw = open(inputPath);
  if (crypto.sha256(raw, "hex").toLowerCase() !== expectedHash) throw new Error(`Safety gate: ${label} hash mismatch.`);
  try {
    return { value: JSON.parse(raw), hash: expectedHash };
  } catch (_error) {
    throw new Error(`Safety gate: ${label} is not valid JSON.`);
  }
}

function loadSyntheticDataset(profile) {
  const { value: dataset, hash } = readHashedJson("SYNTHETIC_DATASET_PATH", "SYNTHETIC_DATASET_SHA256", "synthetic dataset");
  assertExactKeys(dataset, DATASET_KEYS, "dataset");
  if (dataset.schemaVersion !== 1 || dataset.synthetic !== true || dataset.environment !== "staging") {
    throw new Error("Safety gate: dataset must explicitly be schema v1, synthetic and staging-only.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(dataset.seedId || "")) {
    throw new Error("Safety gate: dataset seedId is missing or unsafe.");
  }
  if (!Array.isArray(dataset.users) || dataset.users.length === 0) {
    throw new Error("Safety gate: dataset must contain synthetic users.");
  }
  const aliases = new Set();
  const tokenDigests = new Set();
  for (const user of dataset.users) {
    assertExactKeys(user, DATASET_USER_KEYS, "dataset.users[]");
    if (!/^loadtest-[a-zA-Z0-9_-]{6,48}$/.test(user.alias || "")) {
      throw new Error("Safety gate: every synthetic alias must start with loadtest-.");
    }
    if (aliases.has(user.alias)) throw new Error("Safety gate: synthetic aliases must be unique.");
    aliases.add(user.alias);
    if (typeof user.accessToken !== "string" || user.accessToken.length < 16 || /INJECT|REPLACE|PLACEHOLDER/i.test(user.accessToken)) {
      throw new Error("Safety gate: runtime synthetic access token is missing.");
    }
    if (/^sk[-_]/i.test(user.accessToken) || user.accessToken.includes("@")) {
      throw new Error("Safety gate: accessToken resembles a non-synthetic secret or PII.");
    }
    if (/\s/.test(user.accessToken)) throw new Error("Safety gate: accessToken cannot contain whitespace.");
    const tokenDigest = crypto.sha256(user.accessToken, "hex");
    if (tokenDigests.has(tokenDigest)) throw new Error("Safety gate: synthetic access tokens must be unique.");
    tokenDigests.add(tokenDigest);
    const tokenExpiresAt = Date.parse(user.tokenExpiresAt || "");
    if (!Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now() || tokenExpiresAt > Date.now() + 24 * 60 * 60 * 1000) {
      throw new Error("Safety gate: every accessToken must expire within the authorized 24-hour window.");
    }
  }
  if (profile === "sessions_5000" && dataset.users.length !== 5000) {
    throw new Error("Safety gate: sessions_5000 requires exactly 5,000 unique synthetic users.");
  }
  return { dataset, hash };
}

function assertExactProfiles(profiles) {
  if (JSON.stringify(profiles) !== JSON.stringify(EXPECTED_PROFILES)) {
    throw new Error("Safety gate: profiles.json does not match the approved exact profiles.");
  }
}

function validateAuthorization(input) {
  const { value: approval } = readHashedJson("AUTHORIZATION_MANIFEST_PATH", "AUTHORIZATION_MANIFEST_SHA256", "authorization manifest");
  assertExactKeys(approval, AUTHORIZATION_KEYS, "authorization");
  const expected = input.datasetHash || null;
  if (approval.schemaVersion !== 1 || approval.environment !== "staging") throw new Error("Safety gate: authorization must be schema v1 and staging-only.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,63}$/.test(approval.authorizationId || "")) throw new Error("Safety gate: authorizationId is missing or unsafe.");
  if (approval.testRunId !== input.runId || approval.baseUrl !== input.baseUrl || approval.profile !== input.profile || approval.target !== input.target) {
    throw new Error("Safety gate: authorization scope does not match this run.");
  }
  if ((approval.datasetSha256 || null) !== expected || (approval.mutationScope || null) !== (input.mutationScope || null)) {
    throw new Error("Safety gate: authorization is not bound to the approved dataset and mutation scope.");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(approval.validFrom || "") ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(approval.expiresAt || "")) {
    throw new Error("Safety gate: authorization window must use explicit UTC timestamps.");
  }
  const validFrom = Date.parse(approval.validFrom);
  const expiresAt = Date.parse(approval.expiresAt);
  const now = Date.now();
  if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt) || validFrom > now || expiresAt <= now || expiresAt - validFrom > 24 * 60 * 60 * 1000) {
    throw new Error("Safety gate: authorization window is invalid, expired or longer than 24 hours.");
  }
  if (input.dataset && input.dataset.users.some((user) => Date.parse(user.tokenExpiresAt) > expiresAt)) {
    throw new Error("Safety gate: a synthetic token outlives the approved authorization window.");
  }
  return approval.authorizationId;
}

export function buildRuntime(profiles) {
  assertExactProfiles(profiles);
  if (!exactTrue("RUN_AUTHORIZED")) throw new Error("Safety gate: RUN_AUTHORIZED=true is required.");
  const baseUrl = assertStagingBaseUrl(required("BASE_URL"));
  const profile = required("PROFILE");
  const target = required("TARGET");
  const runId = required("TEST_RUN_ID");
  assertSafeRunId(runId);
  if (!Object.prototype.hasOwnProperty.call(profiles, profile)) throw new Error("Safety gate: unknown PROFILE.");
  if (!TARGETS.has(target)) throw new Error("Safety gate: unknown TARGET.");
  if (RPS_PROFILES.has(profile) && target === "learning_idempotency") {
    throw new Error("Safety gate: RPS profiles accept one-request targets only; learning is a multi-request transaction.");
  }
  if (profile === "sessions_5000" && target !== "auth_read" && target !== "learning_idempotency") {
    throw new Error("Safety gate: sessions_5000 is reserved for authenticated synthetic sessions.");
  }

  let dataset = null;
  let datasetHash = null;
  if (target === "auth_read" || target === "learning_idempotency") {
    const loaded = loadSyntheticDataset(profile);
    dataset = loaded.dataset;
    datasetHash = loaded.hash;
  }
  let mutationScope = null;
  if (target === "learning_idempotency") {
    if (profile !== "sessions_5000") throw new Error("Safety gate: learning mutations require the sessions_5000 profile.");
    if (!exactTrue("ALLOW_MUTATIONS")) throw new Error("Safety gate: ALLOW_MUTATIONS=true is required.");
    mutationScope = required("MUTATION_SCOPE");
    if (mutationScope !== "seeded-learning-idempotency") {
      throw new Error("Safety gate: MUTATION_SCOPE must be seeded-learning-idempotency.");
    }
    for (const user of dataset.users) {
      if (!user.productId || /REPLACE/i.test(user.productId)) throw new Error("Safety gate: seeded productId is required.");
      if (user.examVersionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.examVersionId)) {
        throw new Error("Safety gate: examVersionId must be a UUID when supplied.");
      }
      if (user.mode && !["diagnostic", "practice", "review"].includes(user.mode)) {
        throw new Error("Safety gate: unsupported learning mode.");
      }
    }
  }

  const authReadPath = (__ENV.AUTH_READ_PATH || "/api/v1/me/onboarding-state").trim();
  if (target === "auth_read" && !AUTH_READ_PATHS.has(authReadPath)) {
    throw new Error("Safety gate: AUTH_READ_PATH is not an allowlisted GET-only endpoint.");
  }
  const authorizationId = validateAuthorization({ baseUrl, profile, target, runId, datasetHash, mutationScope, dataset });
  return {
    baseUrl, profile, target, runId, dataset, authReadPath, authorizationId,
    expectedIterations: EXPECTED_ITERATIONS[profile],
    expectedHttpRequests: EXPECTED_ITERATIONS[profile] * (target === "learning_idempotency" ? 3 : 1),
    arrivalRateProfile: RPS_PROFILES.has(profile),
  };
}
