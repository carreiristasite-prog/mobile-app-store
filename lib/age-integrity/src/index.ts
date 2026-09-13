import { z } from "zod";

export const AGE_INTEGRITY_CANONICALIZATION_VERSION = "age-integrity-v1" as const;
export const AGE_INTEGRITY_HTTP_METHOD = "POST" as const;
export const AGE_INTEGRITY_HTTP_PATH = "/api/v1/me/platform-age-signal/verified" as const;

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const LowercaseUuidSchema = z.string().uuid().regex(
  LOWERCASE_UUID,
  "O UUID deve estar em lowercase e na forma canônica.",
);

export const SafeAsciiTokenSchema = z.string().min(1).max(120).regex(
  SAFE_ASCII_TOKEN,
  "Use somente ASCII seguro, sem espaços, Unicode, '=', CR ou LF.",
);

export const PrincipalBindingKeyVersionSchema = z.string().min(1).max(64).regex(
  SAFE_ASCII_TOKEN,
  "A versão da chave deve usar somente ASCII seguro.",
);

/** Decode strictly canonical, unpadded Base64URL without browser/Node globals. */
export function decodeCanonicalBase64Url(value: string): Uint8Array {
  if (!BASE64URL.test(value) || value.includes("=")) throw new Error("base64url_invalid");
  if (value.length % 4 === 1) throw new Error("base64url_length_invalid");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const outputLength = Math.floor(value.length * 6 / 8);
  const output = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("base64url_invalid");
    buffer = (buffer << 6) | digit;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      output[offset] = (buffer >> bits) & 0xff;
      offset += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) throw new Error("base64url_non_canonical_tail");
  if (offset !== output.length) throw new Error("base64url_decode_length_mismatch");
  return output;
}

export const Base64Url32BytesSchema = z.string().length(43).regex(
  /^[A-Za-z0-9_-]{43}$/,
  "Use Base64URL canônico sem padding.",
).superRefine((value, context) => {
  try {
    if (decodeCanonicalBase64Url(value).byteLength !== 32) {
      context.addIssue({ code: "custom", message: "O valor deve codificar exatamente 32 bytes." });
    }
  } catch {
    context.addIssue({ code: "custom", message: "O Base64URL não é canônico." });
  }
});

export const IntegrityPlatformSchema = z.enum(["ios", "android"]);
export const PlatformAgeSignalStatusSchema = z.enum([
  "shared",
  "not_shared",
  "verification_required",
  "not_required",
  "unsupported",
  "error",
]);
export const PlatformAgeBandSchema = z.enum(["under_13", "13_15", "16_17", "18_plus"]);
export const ClientOsApiGenerationSchema = z.enum([
  "ios_pre_26",
  "ios_26",
  "ios_27_or_later",
  "android",
  "unknown",
]);
export const ClientAgeApiCapabilitySchema = z.enum([
  "declared_age_range_available",
  "play_age_signals_available",
  "unsupported",
  "unknown",
]);

export const AgeIntegrityClientContextSchema = z.object({
  osApiGeneration: ClientOsApiGenerationSchema,
  ageApiCapability: ClientAgeApiCapabilitySchema,
  runtimeVersion: SafeAsciiTokenSchema,
  updateLaunch: z.enum(["embedded", "ota"]),
  updateId: z.union([z.literal("embedded"), LowercaseUuidSchema]),
}).strict().superRefine((value, context) => {
  if (value.updateLaunch === "embedded" && value.updateId !== "embedded") {
    context.addIssue({ code: "custom", path: ["updateId"], message: "Build embedded exige updateId=embedded." });
  }
  if (value.updateLaunch === "ota" && value.updateId === "embedded") {
    context.addIssue({ code: "custom", path: ["updateId"], message: "Update OTA exige UUID allowlistável." });
  }
});

export const NormalizedPlatformAgeSignalSchema = z.object({
  platform: IntegrityPlatformSchema,
  status: PlatformAgeSignalStatusSchema,
  ageBand: PlatformAgeBandSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === "shared" && value.ageBand === null) {
    context.addIssue({ code: "custom", path: ["ageBand"], message: "Sinal compartilhado exige faixa normalizada." });
  }
  if (value.status !== "shared" && value.ageBand !== null) {
    context.addIssue({ code: "custom", path: ["ageBand"], message: "Sinal não compartilhado não pode carregar faixa." });
  }
});

type PlatformClaimInput = {
  platform: z.infer<typeof IntegrityPlatformSchema>;
  clientContext: z.infer<typeof AgeIntegrityClientContextSchema>;
  signal: z.infer<typeof NormalizedPlatformAgeSignalSchema>;
  proofKeyId: string | null;
};

export type AgeIntegrityClaimIssue = Readonly<{
  path: readonly (string | number)[];
  message: string;
}>;

/** Shared relational rules used by canonicalization and the public API schema. */
export function ageIntegrityPlatformClaimIssues(value: PlatformClaimInput): readonly AgeIntegrityClaimIssue[] {
  const issues: AgeIntegrityClaimIssue[] = [];
  if (value.signal.platform !== value.platform) {
    issues.push({ path: ["signal", "platform"], message: "A plataforma do sinal diverge do envelope." });
  }
  if (value.platform === "ios") {
    if (value.proofKeyId === null) {
      issues.push({ path: ["proofKeyId"], message: "iOS exige key ID canônico." });
    }
    if (value.clientContext.osApiGeneration === "android"
        || value.clientContext.ageApiCapability === "play_age_signals_available") {
      issues.push({ path: ["clientContext"], message: "Claims Android não pertencem ao envelope iOS." });
    }
    const unavailable = value.clientContext.osApiGeneration === "ios_pre_26"
      || value.clientContext.ageApiCapability === "unsupported";
    if (unavailable && (value.signal.status !== "unsupported" || value.signal.ageBand !== null)) {
      issues.push({
        path: ["signal"],
        message: "iOS anterior a 26/capability ausente deve falhar fechado como unsupported.",
      });
    }
    if (value.signal.status === "shared"
        && (value.clientContext.ageApiCapability !== "declared_age_range_available"
          || !["ios_26", "ios_27_or_later"].includes(value.clientContext.osApiGeneration))) {
      issues.push({ path: ["signal"], message: "Compartilhamento iOS exige capability local disponível." });
    }
  } else {
    if (value.proofKeyId !== null) {
      issues.push({ path: ["proofKeyId"], message: "Android usa proof_key_id=none." });
    }
    if (!["android", "unknown"].includes(value.clientContext.osApiGeneration)
        || value.clientContext.ageApiCapability === "declared_age_range_available") {
      issues.push({ path: ["clientContext"], message: "Claims iOS não pertencem ao envelope Android." });
    }
    if (value.signal.status === "shared"
        && (value.clientContext.osApiGeneration !== "android"
          || value.clientContext.ageApiCapability !== "play_age_signals_available")) {
      issues.push({ path: ["signal"], message: "Compartilhamento Android exige Play Age Signals disponível." });
    }
  }
  return issues;
}

export const AgeIntegrityCanonicalInputSchema = z.object({
  challengeId: LowercaseUuidSchema,
  challengeNonce: Base64Url32BytesSchema,
  principalBinding: Base64Url32BytesSchema,
  principalBindingKeyVersion: PrincipalBindingKeyVersionSchema,
  deviceBindingId: LowercaseUuidSchema,
  platform: IntegrityPlatformSchema,
  clientContext: AgeIntegrityClientContextSchema,
  signal: NormalizedPlatformAgeSignalSchema,
  proofKeyId: Base64Url32BytesSchema.nullable(),
}).strict().superRefine((value, context) => {
  for (const issue of ageIntegrityPlatformClaimIssues(value)) {
    context.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
  }
});

export type AgeIntegrityCanonicalInput = z.infer<typeof AgeIntegrityCanonicalInputSchema>;

const CANONICAL_FIELD_ORDER = [
  "domain",
  "version",
  "challenge_id",
  "challenge_nonce",
  "principal_binding",
  "principal_binding_key_version",
  "device_binding_id",
  "http_method",
  "http_path",
  "platform",
  "source",
  "sharing_status",
  "age_band",
  "client_os_api_generation",
  "client_age_api_capability",
  "runtime_version",
  "update_launch",
  "update_id",
  "proof_key_id",
] as const;

export function canonicalizeAgeIntegrity(input: AgeIntegrityCanonicalInput): string {
  const value = AgeIntegrityCanonicalInputSchema.parse(input);
  const record: Record<(typeof CANONICAL_FIELD_ORDER)[number], string> = {
    domain: "iaaprova.platform-age-signal",
    version: "1",
    challenge_id: value.challengeId,
    challenge_nonce: value.challengeNonce,
    principal_binding: value.principalBinding,
    principal_binding_key_version: value.principalBindingKeyVersion,
    device_binding_id: value.deviceBindingId,
    http_method: AGE_INTEGRITY_HTTP_METHOD,
    http_path: AGE_INTEGRITY_HTTP_PATH,
    platform: value.platform,
    source: value.platform === "ios" ? "apple_declared_age_range" : "google_play_age_signals",
    sharing_status: value.signal.status,
    age_band: value.signal.ageBand ?? "none",
    client_os_api_generation: value.clientContext.osApiGeneration,
    client_age_api_capability: value.clientContext.ageApiCapability,
    runtime_version: value.clientContext.runtimeVersion,
    update_launch: value.clientContext.updateLaunch,
    update_id: value.clientContext.updateId,
    proof_key_id: value.proofKeyId ?? "none",
  };
  return CANONICAL_FIELD_ORDER.map((field) => `${field}=${record[field]}`).join("\n");
}

function strictAsciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) throw new Error("age_integrity_non_ascii_value");
    bytes[index] = code;
  }
  return bytes;
}

export function canonicalAgeIntegrityBytes(input: AgeIntegrityCanonicalInput): Uint8Array {
  return strictAsciiBytes(canonicalizeAgeIntegrity(input));
}

export function appleChallengeUtf8(value: string): Uint8Array {
  const challenge = Base64Url32BytesSchema.parse(value);
  const bytes = strictAsciiBytes(challenge);
  if (bytes.byteLength !== 43) throw new Error("apple_challenge_utf8_length_invalid");
  return bytes;
}

export type IosAgeRangeResponse = { lowerBound: number | null; upperBound: number | null };

/** Local safety adapter. These claims are bound, but remain non-authoritative server-side. */
export function normalizeIosAgeRangeFailClosed(input: {
  osMajor: number | null;
  capabilityAvailable: boolean;
  response: IosAgeRangeResponse | null;
}): { status: "shared" | "unsupported" | "error"; ageBand: z.infer<typeof PlatformAgeBandSchema> | null } {
  if (!input.capabilityAvailable || input.osMajor === null || input.osMajor < 26) {
    return { status: "unsupported", ageBand: null };
  }
  const lower = input.response?.lowerBound ?? null;
  const upper = input.response?.upperBound ?? null;
  if ((lower !== null && (!Number.isInteger(lower) || lower < 0 || lower > 130))
      || (upper !== null && (!Number.isInteger(upper) || upper < 0 || upper > 130))
      || (lower !== null && upper !== null && lower > upper)) {
    return { status: "error", ageBand: null };
  }
  if (lower !== null && lower >= 18 && upper === null) return { status: "shared", ageBand: "18_plus" };
  if (lower === 16 && upper === 17) return { status: "shared", ageBand: "16_17" };
  if (lower === 13 && upper === 15) return { status: "shared", ageBand: "13_15" };
  if ((lower === null || lower === 0) && upper !== null && upper <= 12) {
    return { status: "shared", ageBand: "under_13" };
  }
  return { status: "error", ageBand: null };
}

export const APPLE_CHALLENGE_GOLDEN_VECTOR = Object.freeze({
  challengeString: "m5tRMFBHrHnp2GJDB7g93ITsWSBlrrlmvbHeNXyhI4w",
  utf8Length: 43,
  utf8Hex: "6d3574524d46424872486e7032474a4442376739334954735753426c72726c6d766248654e587968493477",
  sha256Hex: "6a08244b338242e0ef223579fd70b12c1fff239e430233d72d2b344a8b12f011",
  sha256Base64Url: "aggkSzOCQuDvIjV5_XCxLB__I55DAjPXLSs0SosS8BE",
});

export const AGE_INTEGRITY_CANONICAL_GOLDEN_INPUT = Object.freeze({
  challengeId: "ddb9b8ae-0728-4143-a813-361148711dfa",
  challengeNonce: APPLE_CHALLENGE_GOLDEN_VECTOR.challengeString,
  principalBinding: "8dYX-rfh1ZLKmoFi2esSU6uFvTlIvnfAcy8_AqQFcJk",
  principalBindingKeyVersion: "pbk-2026-08",
  deviceBindingId: "2f18785b-a24d-49d0-b529-d7560645312f",
  platform: "ios",
  clientContext: {
    osApiGeneration: "ios_27_or_later",
    ageApiCapability: "declared_age_range_available",
    runtimeVersion: "ios-2026.08-integrity.1",
    updateLaunch: "embedded",
    updateId: "embedded",
  },
  signal: { platform: "ios", status: "shared", ageBand: "18_plus" },
  proofKeyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
} satisfies AgeIntegrityCanonicalInput);
