import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AGE_INTEGRITY_CANONICALIZATION_VERSION,
  AgeIntegrityCanonicalInputSchema,
  Base64Url32BytesSchema,
  PrincipalBindingKeyVersionSchema,
  canonicalizeAgeIntegrity,
  decodeCanonicalBase64Url,
  type AgeIntegrityCanonicalInput,
} from "@workspace/age-integrity";

export const APP_INTEGRITY_PHASE_A_POLICY_VERSION = "app-integrity-phase-a.v1" as const;

export type AppIntegrityEnvironment = "development" | "production";

export type AppIntegrityConfig = Readonly<{
  environment: AppIntegrityEnvironment;
  principalBindingCurrentVersion: string;
  principalBindingKeys: ReadonlyMap<string, Uint8Array>;
  challengeTtlSeconds: 120;
  maxOutstandingChallenges: 3;
  policyVersion: typeof APP_INTEGRITY_PHASE_A_POLICY_VERSION;
}>;

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`app_integrity_config_missing:${name}`);
  return value;
}

export function loadAppIntegrityConfig(env: NodeJS.ProcessEnv = process.env): AppIntegrityConfig {
  const environment = required("INTEGRITY_ENVIRONMENT", env);
  if (environment !== "development" && environment !== "production") {
    throw new Error("app_integrity_environment_invalid");
  }
  const currentVersion = PrincipalBindingKeyVersionSchema.parse(
    required("INTEGRITY_PRINCIPAL_BINDING_CURRENT_VERSION", env),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(required("INTEGRITY_PRINCIPAL_BINDING_KEYS_JSON", env));
  } catch {
    throw new Error("app_integrity_binding_keys_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw new Error("app_integrity_binding_keys_invalid_shape");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 3) throw new Error("app_integrity_binding_key_count_invalid");
  const keys = new Map<string, Uint8Array>();
  for (const [rawVersion, rawKey] of entries) {
    const version = PrincipalBindingKeyVersionSchema.parse(rawVersion);
    const encoded = Base64Url32BytesSchema.parse(rawKey);
    keys.set(version, decodeCanonicalBase64Url(encoded));
  }
  if (!keys.has(currentVersion)) throw new Error("app_integrity_current_binding_key_missing");
  return Object.freeze({
    environment,
    principalBindingCurrentVersion: currentVersion,
    principalBindingKeys: keys,
    challengeTtlSeconds: 120,
    maxOutstandingChallenges: 3,
    policyVersion: APP_INTEGRITY_PHASE_A_POLICY_VERSION,
  });
}

function keyFor(config: AppIntegrityConfig, version: string): Uint8Array {
  const key = config.principalBindingKeys.get(version);
  if (!key) throw new Error("app_integrity_binding_key_version_unavailable");
  return key;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Base64Url(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function derivePrincipalBinding(input: {
  config: AppIntegrityConfig;
  version: string;
  userId: string;
  providerSubject: string;
}): string {
  const message = `v1\0${input.userId}\0${input.providerSubject}`;
  return createHmac("sha256", keyFor(input.config, input.version)).update(message, "utf8").digest("base64url");
}

export function deriveAuthSessionHash(input: {
  config: AppIntegrityConfig;
  version: string;
  providerSessionId: string;
}): string {
  return createHmac("sha256", keyFor(input.config, input.version))
    .update(`session-v1\0${input.providerSessionId}`, "utf8")
    .digest("hex");
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export function deviceBindingRequestDigest(input: { installationNonce: string; platform: "ios" | "android" }): string {
  return sha256Hex(`domain=iaaprova.integrity-device-binding\nversion=1\ninstallation_nonce=${input.installationNonce}\nplatform=${input.platform}`);
}

export function canonicalEnvelope(input: AgeIntegrityCanonicalInput): {
  canonical: string;
  requestDigest: string;
} {
  const canonical = canonicalizeAgeIntegrity(AgeIntegrityCanonicalInputSchema.parse(input));
  return { canonical, requestDigest: sha256Base64Url(canonical) };
}

export function integrityEnvelopeDigest(input: {
  canonical: string;
  provider: "apple_app_attest" | "google_play_integrity_standard";
  proofDigest: string;
}): string {
  return sha256Hex(`${input.canonical}\0${input.provider}\0${input.proofDigest}`);
}

export interface PhaseAProviderAdapter {
  readonly provider: "apple_app_attest" | "google_play_integrity_standard";
  evaluate(): Promise<{
    status: "indeterminate";
    outcomeCode: "provider_not_implemented_phase_a";
    appBuildDecision: "not_evaluated";
    deviceDecision: "not_evaluated";
  }>;
}

class FailClosedPhaseAProviderAdapter implements PhaseAProviderAdapter {
  readonly provider: PhaseAProviderAdapter["provider"];

  constructor(provider: PhaseAProviderAdapter["provider"]) {
    this.provider = provider;
  }

  async evaluate(): Promise<Awaited<ReturnType<PhaseAProviderAdapter["evaluate"]>>> {
    return {
      status: "indeterminate",
      outcomeCode: "provider_not_implemented_phase_a",
      appBuildDecision: "not_evaluated",
      deviceDecision: "not_evaluated",
    };
  }
}

export const PHASE_A_PROVIDER_ADAPTERS: Readonly<Record<PhaseAProviderAdapter["provider"], PhaseAProviderAdapter>> = Object.freeze({
  apple_app_attest: new FailClosedPhaseAProviderAdapter("apple_app_attest"),
  google_play_integrity_standard: new FailClosedPhaseAProviderAdapter("google_play_integrity_standard"),
});

export { AGE_INTEGRITY_CANONICALIZATION_VERSION };
