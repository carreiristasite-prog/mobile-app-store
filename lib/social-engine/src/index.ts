import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SOCIAL_REQUEST_SCHEMA_VERSION = "iaaprova.social.request.v1" as const;
export const DUEL_RULES_SCHEMA_VERSION = "iaaprova.social.duel-rules.v1" as const;
export const DUEL_QUOTA_SCHEMA_VERSION = "iaaprova.social.duel-quota.v1" as const;
export const DUEL_STATE_SCHEMA_VERSION = "iaaprova.social.duel-state.v1" as const;
export const DUEL_COMMAND_SCHEMA_VERSION = "iaaprova.social.duel-command.v1" as const;
export const DUEL_EVENT_SCHEMA_VERSION = "iaaprova.social.duel-event.v1" as const;
export const DUEL_RECEIPT_SCHEMA_VERSION = "iaaprova.social.duel-receipt.v1" as const;
export const DUEL_APPLY_RESULT_SCHEMA_VERSION = "iaaprova.social.duel-apply-result.v1" as const;

const LOWER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const KEY_VERSION_PATTERN = /^v[1-9][0-9]{0,8}$/;
const INVITE_CODE_PATTERN = /^[A-Z0-9]{16,128}$/;
const OPAQUE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const lowerUuidSchema = z.string().regex(LOWER_UUID_PATTERN);
const sha256HexSchema = z.string().regex(SHA256_HEX_PATTERN);
const keyVersionSchema = z.string().regex(KEY_VERSION_PATTERN);
const opaqueKeySchema = z.string().regex(OPAQUE_KEY_PATTERN);
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe();
const positiveIntegerSchema = z.number().int().positive().safe();
const utcTimestampSchema = z.string().datetime({ offset: true }).refine((value) => value.endsWith("Z"), {
  message: "timestamp_must_be_utc",
});

export class SocialEngineError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SocialEngineError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new SocialEngineError(code);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (typeof value !== "object" || value === null) return value as Readonly<T>;
  if (seen.has(value)) return value as Readonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.isFrozen(value) ? value as Readonly<T> : Object.freeze(value);
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("jcs_invalid_unicode");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("jcs_invalid_unicode");
    }
  }
}

function assertPlainDataObject(value: object): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("jcs_non_plain_object");
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set || !("value" in descriptor)) {
      fail(`jcs_invalid_property_${key}`);
    }
  }
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) fail("jcs_symbol_key_not_supported");
}

export type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | {
  readonly [key: string]: CanonicalJson;
};

export const CANONICAL_JSON_V1_LIMITS = deepFreeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxArrayLength: 4_096,
  maxObjectProperties: 1_024,
  maxStringUtf8Bytes: 262_144,
});

type CanonicalizationContext = {
  nodes: number;
  readonly ancestors: Set<object>;
};

function assertCanonicalStringBound(value: string): void {
  if (Buffer.byteLength(value, "utf8") > CANONICAL_JSON_V1_LIMITS.maxStringUtf8Bytes) {
    fail("jcs_string_too_large");
  }
}

function normalizeCanonicalJsonInternalV1(
  value: unknown,
  context: CanonicalizationContext,
  depth: number,
): CanonicalJson {
  if (depth > CANONICAL_JSON_V1_LIMITS.maxDepth) fail("jcs_max_depth_exceeded");
  context.nodes += 1;
  if (context.nodes > CANONICAL_JSON_V1_LIMITS.maxNodes) fail("jcs_max_nodes_exceeded");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    assertCanonicalStringBound(value);
    return value.normalize("NFC");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("jcs_non_finite_number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (context.ancestors.has(value)) fail("jcs_cycle");
    if (value.length > CANONICAL_JSON_V1_LIMITS.maxArrayLength) fail("jcs_array_too_large");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) fail("jcs_symbol_key_not_supported");
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) fail("jcs_sparse_array");
    }
    const allowedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))) fail("jcs_array_extra_property");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || descriptor.get || descriptor.set || !("value" in descriptor)) {
        fail("jcs_array_accessor_not_supported");
      }
    }
    context.ancestors.add(value);
    try {
      return value.map((item) => normalizeCanonicalJsonInternalV1(item, context, depth + 1));
    } finally {
      context.ancestors.delete(value);
    }
  }
  if (typeof value === "object") {
    if (context.ancestors.has(value)) fail("jcs_cycle");
    assertPlainDataObject(value);
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue);
    if (keys.length > CANONICAL_JSON_V1_LIMITS.maxObjectProperties) fail("jcs_object_too_large");
    context.ancestors.add(value);
    try {
      const normalizedEntries = keys.map((key) => {
        assertWellFormedUnicode(key);
        assertCanonicalStringBound(key);
        return [key.normalize("NFC"), normalizeCanonicalJsonInternalV1(objectValue[key], context, depth + 1)] as const;
      });
      const normalizedKeys = normalizedEntries.map(([key]) => key);
      if (new Set(normalizedKeys).size !== normalizedKeys.length) fail("jcs_nfc_key_collision");
      normalizedEntries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      return Object.fromEntries(normalizedEntries);
    } finally {
      context.ancestors.delete(value);
    }
  }
  fail("jcs_unsupported_value");
}

/** RFC 8785/JCS-compatible JSON data with every string and property name normalized to NFC. */
export function normalizeCanonicalJsonV1(value: unknown): CanonicalJson {
  return normalizeCanonicalJsonInternalV1(value, { nodes: 0, ancestors: new Set<object>() }, 0);
}

/** Serializes normalized JSON according to RFC 8785/JCS ordering and ECMAScript number encoding. */
export function jcsSerializeV1(value: unknown): string {
  const serialized = JSON.stringify(normalizeCanonicalJsonV1(value));
  if (serialized === undefined) fail("jcs_unsupported_value");
  return serialized;
}

function base64UrlUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function assertHmacKey(key: Uint8Array, name: string): void {
  if (!(key instanceof Uint8Array) || key.byteLength < 32) fail(`${name}_must_be_at_least_32_bytes`);
}

function safeHexEquals(left: string, right: string): boolean {
  if (!SHA256_HEX_PATTERN.test(left) || !SHA256_HEX_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function buildInviteDigestPreimageV1(code: string): string {
  if (!INVITE_CODE_PATTERN.test(code)) fail("invite_code_invalid");
  return `domain=iaaprova.social.invite\nversion=1\ncode=${code}\n`;
}

export function digestInviteCodeV1(code: string, inviteDigestKey: Uint8Array): string {
  assertHmacKey(inviteDigestKey, "invite_digest_key");
  return createHmac("sha256", inviteDigestKey).update(buildInviteDigestPreimageV1(code), "utf8").digest("hex");
}

const requestBase = {
  schemaVersion: z.literal(SOCIAL_REQUEST_SCHEMA_VERSION),
  authority: z.literal("server"),
  actorUserId: lowerUuidSchema,
};

const profileCreateRequestSchema = z.object({
  ...requestBase,
  operation: z.literal("social_profile_create"),
  method: z.literal("POST"),
  routeTemplate: z.literal("/api/v1/social/profile"),
  resourceScope: z.literal("-"),
  body: z.object({ avatarKey: opaqueKeySchema }).strict(),
}).strict();

const friendRequestCreateSchema = z.object({
  ...requestBase,
  operation: z.literal("social_friend_request_create"),
  method: z.literal("POST"),
  routeTemplate: z.literal("/api/v1/social/friend-requests"),
  resourceScope: z.literal("-"),
  body: z.object({ inviteCode: z.string().regex(INVITE_CODE_PATTERN) }).strict(),
}).strict();

const socialReportCreateSchema = z.object({
  ...requestBase,
  operation: z.literal("social_report_create"),
  method: z.literal("POST"),
  routeTemplate: z.literal("/api/v1/social/reports"),
  resourceScope: z.literal("-"),
  body: z.object({
    targetType: z.enum(["user", "duel"]),
    targetId: lowerUuidSchema,
    reason: z.enum(["abuse", "threat", "minor_safety", "fraud"]),
    note: z.string().max(500).nullable().optional(),
  }).strict(),
}).strict();

const duelReadyRequestSchema = z.object({
  ...requestBase,
  operation: z.literal("duel_ready"),
  method: z.literal("WS_COMMAND"),
  routeTemplate: z.literal("/api/v1/social/duels/{duelId}"),
  resourceScope: lowerUuidSchema,
  body: z.object({
    participantId: lowerUuidSchema,
    observedStateVersion: nonNegativeIntegerSchema,
    connectionEpoch: positiveIntegerSchema,
  }).strict(),
}).strict();

const duelAnswerRequestSchema = z.object({
  ...requestBase,
  operation: z.literal("duel_answer"),
  method: z.literal("WS_COMMAND"),
  routeTemplate: z.literal("/api/v1/social/duels/{duelId}"),
  resourceScope: lowerUuidSchema,
  body: z.object({
    participantId: lowerUuidSchema,
    roundId: lowerUuidSchema,
    selectedOptionId: lowerUuidSchema,
    observedStateVersion: nonNegativeIntegerSchema,
    observedRoundVersion: nonNegativeIntegerSchema,
    connectionEpoch: positiveIntegerSchema,
  }).strict(),
}).strict();

const duelResumeRequestSchema = z.object({
  ...requestBase,
  operation: z.literal("duel_resume"),
  method: z.literal("WS_COMMAND"),
  routeTemplate: z.literal("/api/v1/social/duels/{duelId}"),
  resourceScope: lowerUuidSchema,
  body: z.object({
    participantId: lowerUuidSchema,
    lastServerSeq: nonNegativeIntegerSchema,
    acknowledgedServerSeqs: z.array(nonNegativeIntegerSchema).max(128),
    connectionEpoch: positiveIntegerSchema,
  }).strict(),
}).strict();

export const CanonicalSocialRequestV1Schema = z.discriminatedUnion("operation", [
  profileCreateRequestSchema,
  friendRequestCreateSchema,
  socialReportCreateSchema,
  duelReadyRequestSchema,
  duelAnswerRequestSchema,
  duelResumeRequestSchema,
]);

export type CanonicalSocialRequestV1 = z.infer<typeof CanonicalSocialRequestV1Schema>;

export type CanonicalRequestKeysV1 = Readonly<{
  requestHashKey: Uint8Array;
  requestHashKeyVersion: string;
  inviteDigestKey?: Uint8Array;
  inviteDigestKeyVersion?: string;
}>;

export const CanonicalRequestHashV1Schema = z.object({
  schemaVersion: z.literal(SOCIAL_REQUEST_SCHEMA_VERSION),
  authority: z.literal("server"),
  operation: z.enum([
    "social_profile_create",
    "social_friend_request_create",
    "social_report_create",
    "duel_ready",
    "duel_answer",
    "duel_resume",
  ]),
  bodyJcs: z.string().max(1_048_576),
  bodyJcsBase64Url: z.string().regex(/^[A-Za-z0-9_-]+$/).max(1_398_102),
  preimage: z.string().max(1_400_000),
  requestHash: sha256HexSchema,
  requestHashKeyVersion: keyVersionSchema,
}).strict();

export type CanonicalRequestHashV1 = Readonly<z.infer<typeof CanonicalRequestHashV1Schema>>;

export function buildCanonicalRequestHashV1(
  rawInput: unknown,
  keys: CanonicalRequestKeysV1,
): CanonicalRequestHashV1 {
  const input = CanonicalSocialRequestV1Schema.parse(rawInput);
  assertHmacKey(keys.requestHashKey, "request_hash_key");
  const requestHashKeyVersion = keyVersionSchema.parse(keys.requestHashKeyVersion);

  let transformedBody: unknown = input.body;
  if (input.operation === "social_friend_request_create") {
    if (!keys.inviteDigestKey || !keys.inviteDigestKeyVersion) fail("invite_digest_key_required");
    const inviteCodeDigestKeyVersion = keyVersionSchema.parse(keys.inviteDigestKeyVersion);
    transformedBody = {
      inviteCodeDigest: digestInviteCodeV1(input.body.inviteCode, keys.inviteDigestKey),
      inviteCodeDigestKeyVersion,
    };
  }

  const bodyJcs = jcsSerializeV1(transformedBody);
  const bodyJcsBase64Url = base64UrlUtf8(bodyJcs);
  const preimage = [
    "domain=iaaprova.social.request",
    "version=1",
    `operation=${input.operation}`,
    `actor_user_id=${input.actorUserId}`,
    `method=${input.method}`,
    `route_template=${input.routeTemplate}`,
    `resource_scope=${input.resourceScope}`,
    `body_jcs_b64u=${bodyJcsBase64Url}`,
    "",
  ].join("\n");
  const requestHash = createHmac("sha256", keys.requestHashKey).update(preimage, "utf8").digest("hex");
  return deepFreeze(CanonicalRequestHashV1Schema.parse({
    schemaVersion: SOCIAL_REQUEST_SCHEMA_VERSION,
    authority: "server",
    operation: input.operation,
    bodyJcs,
    bodyJcsBase64Url,
    preimage,
    requestHash,
    requestHashKeyVersion,
  }));
}

const duelRulesDraftV1Shape = {
  schemaVersion: z.literal(DUEL_RULES_SCHEMA_VERSION),
  authority: z.literal("server"),
  rulesVersionId: lowerUuidSchema,
  productId: lowerUuidSchema,
  examVersionId: lowerUuidSchema,
  roundCount: z.number().int().min(1).max(100),
  roundDurationSeconds: z.number().int().min(5).max(600),
  scoring: z.object({
    correctPoints: z.literal(1),
    incorrectPoints: z.literal(0),
    unansweredPoints: z.literal(0),
    tieBreak: z.literal("draw"),
  }).strict(),
  rankedEligiblePerIsoWeek: z.object({
    free: z.literal(3),
    pro: z.literal(3),
  }).strict(),
  freeTotalDuelsPerIsoWeek: z.literal(3),
  proUnrankedPracticePerIsoWeek: z.null(),
  quotaWindow: z.object({
    kind: z.literal("iso_week_utc"),
    weekStarts: z.literal("monday"),
    startsAt: z.literal("00:00:00Z"),
  }).strict(),
  consumption: z.object({
    consumeWhen: z.literal("match_active"),
    restituteWhen: z.tuple([z.literal("cancelled"), z.literal("no_contest")]),
    requiresNoParticipantFault: z.literal(true),
  }).strict(),
  publishedAt: utcTimestampSchema,
} satisfies z.ZodRawShape;

const duelRulesDraftV1Schema = z.object(duelRulesDraftV1Shape).strict();

export const DuelRulesVersionV1Schema = z.object({
  ...duelRulesDraftV1Shape,
  canonicalHash: sha256HexSchema,
}).strict();

export type DuelRulesDraftV1 = z.infer<typeof duelRulesDraftV1Schema>;
export type DuelRulesVersionV1 = z.infer<typeof DuelRulesVersionV1Schema>;

export function buildDuelRulesHashPreimageV1(rawDraft: unknown): string {
  const draft = duelRulesDraftV1Schema.parse(rawDraft);
  const body = jcsSerializeV1(draft);
  return `domain=iaaprova.social.duel-rules\nversion=1\nbody_jcs_b64u=${base64UrlUtf8(body)}\n`;
}

function rulesHashFromDraft(draft: DuelRulesDraftV1): string {
  return createHash("sha256").update(buildDuelRulesHashPreimageV1(draft), "utf8").digest("hex");
}

export function createDuelRulesVersionV1(rawDraft: unknown): Readonly<DuelRulesVersionV1> {
  const draft = duelRulesDraftV1Schema.parse(rawDraft);
  return deepFreeze({ ...draft, canonicalHash: rulesHashFromDraft(draft) });
}

export function parseAndVerifyDuelRulesVersionV1(rawRules: unknown): Readonly<DuelRulesVersionV1> {
  const rules = DuelRulesVersionV1Schema.parse(rawRules);
  const { canonicalHash, ...draft } = rules;
  const expected = rulesHashFromDraft(draft);
  if (!safeHexEquals(canonicalHash, expected)) fail("duel_rules_hash_mismatch");
  return deepFreeze(rules);
}

export const DuelQuotaAuthorityInputV1Schema = z.object({
  schemaVersion: z.literal(DUEL_QUOTA_SCHEMA_VERSION),
  authority: z.literal("server"),
  now: utcTimestampSchema,
  plan: z.enum(["free", "pro"]),
  competitionMode: z.enum(["ranked", "unranked"]),
  windowUsage: z.object({
    windowStart: utcTimestampSchema,
    windowEnd: utcTimestampSchema,
    rankedConsumed: nonNegativeIntegerSchema,
    freeTotalConsumed: nonNegativeIntegerSchema,
  }).strict(),
}).strict();

export type DuelQuotaAuthorityInputV1 = z.infer<typeof DuelQuotaAuthorityInputV1Schema>;

export const IsoWeekUtcWindowV1Schema = z.object({
  start: utcTimestampSchema,
  end: utcTimestampSchema,
}).strict().superRefine((window, context) => {
  const start = new Date(window.start);
  const end = new Date(window.end);
  if (start.getUTCDay() !== 1
    || start.getUTCHours() !== 0
    || start.getUTCMinutes() !== 0
    || start.getUTCSeconds() !== 0
    || start.getUTCMilliseconds() !== 0
    || end.getTime() - start.getTime() !== 7 * 24 * 60 * 60 * 1_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_iso_week_utc_window" });
  }
});

export type IsoWeekUtcWindowV1 = Readonly<z.infer<typeof IsoWeekUtcWindowV1Schema>>;

export function isoWeekUtcWindowV1(rawNow: string): IsoWeekUtcWindowV1 {
  const now = utcTimestampSchema.parse(rawNow);
  const instant = new Date(now);
  const day = instant.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const startMs = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() - daysSinceMonday);
  return deepFreeze(IsoWeekUtcWindowV1Schema.parse({
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 7 * 24 * 60 * 60 * 1_000).toISOString(),
  }));
}

export const DuelQuotaDecisionV1Schema = z.object({
  schemaVersion: z.literal(DUEL_QUOTA_SCHEMA_VERSION),
  authority: z.literal("server"),
  allowed: z.boolean(),
  reason: z.enum(["allowed", "ranked_weekly_limit_reached", "free_total_weekly_limit_reached", "unranked_requires_pro"]),
  window: IsoWeekUtcWindowV1Schema,
  rankedRemaining: nonNegativeIntegerSchema,
  freeTotalRemaining: nonNegativeIntegerSchema.nullable(),
  unrankedPlanRemaining: z.null(),
}).strict().superRefine((decision, context) => {
  if (decision.allowed !== (decision.reason === "allowed")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "quota_decision_reason_mismatch" });
  }
});

export type DuelQuotaDecisionV1 = Readonly<z.infer<typeof DuelQuotaDecisionV1Schema>>;

export function evaluateDuelQuotaV1(rawRules: unknown, rawInput: unknown): DuelQuotaDecisionV1 {
  const rules = parseAndVerifyDuelRulesVersionV1(rawRules);
  const input = DuelQuotaAuthorityInputV1Schema.parse(rawInput);
  const window = isoWeekUtcWindowV1(input.now);
  if (input.windowUsage.windowStart !== window.start || input.windowUsage.windowEnd !== window.end) {
    fail("quota_window_mismatch");
  }
  const rankedLimit = rules.rankedEligiblePerIsoWeek[input.plan];
  const rankedRemaining = Math.max(0, rankedLimit - input.windowUsage.rankedConsumed);
  const freeTotalRemaining = input.plan === "free"
    ? Math.max(0, rules.freeTotalDuelsPerIsoWeek - input.windowUsage.freeTotalConsumed)
    : null;

  let reason: DuelQuotaDecisionV1["reason"] = "allowed";
  if (input.competitionMode === "unranked" && input.plan === "free") reason = "unranked_requires_pro";
  else if (input.competitionMode === "ranked" && rankedRemaining === 0) reason = "ranked_weekly_limit_reached";
  else if (input.plan === "free" && freeTotalRemaining === 0) reason = "free_total_weekly_limit_reached";

  return deepFreeze(DuelQuotaDecisionV1Schema.parse({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    allowed: reason === "allowed",
    reason,
    window,
    rankedRemaining,
    freeTotalRemaining,
    unrankedPlanRemaining: null,
  }));
}

export const DuelQuotaLedgerEffectInputV1Schema = z.object({
  schemaVersion: z.literal(DUEL_QUOTA_SCHEMA_VERSION),
  authority: z.literal("server"),
  plan: z.enum(["free", "pro"]),
  competitionMode: z.enum(["ranked", "unranked"]),
  previousStatus: z.enum(["queued", "matched", "ready", "active", "under_review"]),
  nextStatus: z.enum(["active", "cancelled", "no_contest", "completed", "forfeited", "expired", "under_review"]),
  participantFault: z.boolean(),
}).strict().superRefine((input, context) => {
  if (input.plan === "free" && input.competitionMode === "unranked") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "free_unranked_not_permitted" });
  }
});

export const DuelQuotaLedgerEffectV1Schema = z.object({
  schemaVersion: z.literal(DUEL_QUOTA_SCHEMA_VERSION),
  authority: z.literal("server"),
  rankedConsumedDelta: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  freeTotalConsumedDelta: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  reason: z.enum(["match_started", "eligible_restitution", "no_quota_change"]),
}).strict();

export type DuelQuotaLedgerEffectV1 = Readonly<z.infer<typeof DuelQuotaLedgerEffectV1Schema>>;

export function duelQuotaLedgerEffectV1(rawInput: unknown): DuelQuotaLedgerEffectV1 {
  const input = DuelQuotaLedgerEffectInputV1Schema.parse(rawInput);
  const consumed = input.previousStatus === "ready" && input.nextStatus === "active";
  const restituted = (input.previousStatus === "active" || input.previousStatus === "under_review")
    && (input.nextStatus === "cancelled" || input.nextStatus === "no_contest")
    && !input.participantFault;
  const delta: -1 | 0 | 1 = consumed ? 1 : restituted ? -1 : 0;
  const rankedConsumedDelta = input.competitionMode === "ranked" ? delta : 0;
  const freeTotalConsumedDelta = input.plan === "free" ? delta : 0;
  const changesQuota = rankedConsumedDelta !== 0 || freeTotalConsumedDelta !== 0;
  return deepFreeze(DuelQuotaLedgerEffectV1Schema.parse({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    rankedConsumedDelta,
    freeTotalConsumedDelta,
    reason: changesQuota && consumed ? "match_started" : changesQuota && restituted ? "eligible_restitution" : "no_quota_change",
  }));
}

const resultNoneSchema = z.object({
  status: z.literal("none"),
  outcome: z.null(),
  provisionalResultHash: z.null(),
  finalResultHash: z.null(),
}).strict();

const performanceOutcomeSchema = z.enum(["seat_a_win", "seat_b_win", "draw"]);
const resultProvisionalSchema = z.object({
  status: z.literal("provisional"),
  outcome: performanceOutcomeSchema.nullable(),
  provisionalResultHash: sha256HexSchema,
  finalResultHash: z.null(),
}).strict();

const resultFinalSchema = z.object({
  status: z.literal("final"),
  outcome: z.enum([
    "seat_a_win",
    "seat_b_win",
    "draw",
    "no_contest",
    "cancelled",
    "expired",
    "forfeit_seat_a",
    "forfeit_seat_b",
  ]),
  provisionalResultHash: sha256HexSchema.nullable(),
  finalResultHash: sha256HexSchema.nullable(),
}).strict();

export const DuelResultV1Schema = z.discriminatedUnion("status", [
  resultNoneSchema,
  resultProvisionalSchema,
  resultFinalSchema,
]).superRefine((value, context) => {
  if (value.status !== "final") return;
  const mustHaveHash = ["seat_a_win", "seat_b_win", "draw", "forfeit_seat_a", "forfeit_seat_b"].includes(value.outcome);
  if (mustHaveHash !== (value.finalResultHash !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "final_result_hash_outcome_mismatch" });
  }
});

const duelStatusSchema = z.enum(["queued", "matched", "ready", "active", "under_review", "completed", "forfeited", "no_contest", "cancelled", "expired"]);

export const DuelStateV1Schema = z.object({
  schemaVersion: z.literal(DUEL_STATE_SCHEMA_VERSION),
  authority: z.literal("server"),
  matchId: lowerUuidSchema,
  rulesVersionId: lowerUuidSchema,
  rulesCanonicalHash: sha256HexSchema,
  competitionMode: z.enum(["ranked", "unranked"]),
  status: duelStatusSchema,
  stateVersion: nonNegativeIntegerSchema,
  serverSeq: nonNegativeIntegerSchema,
  snapshotHash: sha256HexSchema.nullable(),
  result: DuelResultV1Schema,
  riskState: z.enum(["none", "block_conflict", "adjudicated"]),
  riskCaseId: lowerUuidSchema.nullable(),
  blockConflictCount: nonNegativeIntegerSchema,
  ledgerStatus: z.enum(["not_applicable", "pending", "eligible", "discarded"]),
  finishReason: z.enum(["normal", "security_interruption", "adjudicated_normal", "adjudicated_forfeit", "adjudicated_no_contest", "cancelled", "expired"]).nullable(),
  adjudicationPolicyVersion: opaqueKeySchema.nullable(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
}).strict().superRefine((state, context) => {
  const terminal = ["completed", "forfeited", "no_contest", "cancelled", "expired"].includes(state.status);
  if (state.stateVersion !== state.serverSeq) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "state_and_sequence_version_mismatch" });
  }
  if (Date.parse(state.updatedAt) < Date.parse(state.createdAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "state_timestamp_order_invalid" });
  }
  if (state.status === "under_review" && (state.result.status !== "provisional"
    || state.riskState !== "block_conflict"
    || state.riskCaseId === null
    || state.ledgerStatus !== "pending"
    || state.adjudicationPolicyVersion !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "under_review_invariant_failed" });
  }
  if (state.status !== "under_review" && state.riskState === "block_conflict") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "block_conflict_requires_under_review" });
  }
  if (state.riskState === "adjudicated") {
    if (!terminal || state.riskCaseId === null || state.adjudicationPolicyVersion === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "adjudication_metadata_required" });
    }
  } else if (state.adjudicationPolicyVersion !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "adjudication_policy_without_decision" });
  }
  if (state.riskState === "none" && state.riskCaseId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "risk_case_without_risk_state" });
  }
  if (terminal !== (state.result.status === "final")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "terminal_result_invariant_failed" });
  }
  if (!terminal && state.status !== "under_review" && state.result.status !== "none") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "non_terminal_result_invariant_failed" });
  }
  if (["matched", "ready", "active", "under_review", "completed", "forfeited", "no_contest"].includes(state.status) && state.snapshotHash === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "snapshot_required" });
  }
  if (state.ledgerStatus === "eligible" && (state.competitionMode !== "ranked"
    || !["completed", "forfeited"].includes(state.status)
    || state.result.status !== "final"
    || state.result.finalResultHash === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "eligible_ledger_requires_final_ranked_result" });
  }
  if (state.ledgerStatus === "pending" && (state.competitionMode !== "ranked" || !["active", "under_review"].includes(state.status))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "pending_ledger_state_invalid" });
  }
  if (state.status === "under_review" && (state.competitionMode !== "ranked" || state.blockConflictCount < 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "under_review_requires_ranked_block_conflict" });
  }

  const addStatusIssue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (["queued", "matched", "ready"].includes(state.status)) {
    if (state.result.status !== "none" || state.riskState !== "none" || state.finishReason !== null
      || state.ledgerStatus !== "not_applicable" || state.adjudicationPolicyVersion !== null) {
      addStatusIssue("pre_start_state_invariant_failed");
    }
    if (state.status === "queued" && state.snapshotHash !== null) addStatusIssue("queued_snapshot_must_be_null");
  } else if (state.status === "active") {
    const expectedLedger = state.competitionMode === "ranked" ? "pending" : "not_applicable";
    if (state.result.status !== "none" || state.riskState !== "none" || state.finishReason !== null
      || state.ledgerStatus !== expectedLedger || state.adjudicationPolicyVersion !== null) {
      addStatusIssue("active_state_invariant_failed");
    }
  } else if (state.status === "completed") {
    const expectedLedger = state.competitionMode === "ranked" ? "eligible" : "not_applicable";
    if (state.result.status !== "final" || !performanceOutcomeSchema.safeParse(state.result.outcome).success
      || state.ledgerStatus !== expectedLedger) {
      addStatusIssue("completed_state_invariant_failed");
    } else if (state.riskState === "none"
      ? state.finishReason !== "normal" || state.result.provisionalResultHash !== null
      : state.riskState !== "adjudicated" || state.finishReason !== "adjudicated_normal" || state.result.provisionalResultHash === null) {
      addStatusIssue("completed_result_provenance_invalid");
    }
  } else if (state.status === "forfeited") {
    if (state.result.status !== "final"
      || !["forfeit_seat_a", "forfeit_seat_b"].includes(state.result.outcome)
      || state.result.provisionalResultHash === null
      || state.riskState !== "adjudicated"
      || state.finishReason !== "adjudicated_forfeit"
      || state.ledgerStatus !== (state.competitionMode === "ranked" ? "eligible" : "not_applicable")) {
      addStatusIssue("forfeited_state_invariant_failed");
    }
  } else if (state.status === "no_contest") {
    if (state.result.status !== "final" || state.result.outcome !== "no_contest" || state.ledgerStatus !== "discarded") {
      addStatusIssue("no_contest_state_invariant_failed");
    } else if (state.riskState === "none"
      ? state.finishReason !== "security_interruption" || state.result.provisionalResultHash !== null
      : state.riskState !== "adjudicated" || state.finishReason !== "adjudicated_no_contest" || state.result.provisionalResultHash === null) {
      addStatusIssue("no_contest_result_provenance_invalid");
    }
  } else if (state.status === "cancelled") {
    if (state.result.status !== "final" || state.result.outcome !== "cancelled"
      || state.result.provisionalResultHash !== null || state.riskState !== "none"
      || !["cancelled", "security_interruption"].includes(state.finishReason ?? "") || state.ledgerStatus !== "discarded") {
      addStatusIssue("cancelled_state_invariant_failed");
    }
  } else if (state.status === "expired") {
    if (state.result.status !== "final" || state.result.outcome !== "expired"
      || state.result.provisionalResultHash !== null || state.riskState !== "none"
      || state.finishReason !== "expired" || state.ledgerStatus !== "discarded") {
      addStatusIssue("expired_state_invariant_failed");
    }
  }
});

export type DuelStateV1 = z.infer<typeof DuelStateV1Schema>;

const commandBase = {
  schemaVersion: z.literal(DUEL_COMMAND_SCHEMA_VERSION),
  authority: z.literal("server"),
  commandId: lowerUuidSchema,
  matchId: lowerUuidSchema,
  expectedStateVersion: nonNegativeIntegerSchema,
  receivedAt: utcTimestampSchema,
};

const pairMatchCommandSchema = z.object({
  ...commandBase,
  commandType: z.literal("pair_match"),
  snapshotHash: sha256HexSchema,
}).strict();
const markReadyCommandSchema = z.object({ ...commandBase, commandType: z.literal("mark_ready") }).strict();
const startMatchCommandSchema = z.object({ ...commandBase, commandType: z.literal("start_match") }).strict();
const completeMatchCommandSchema = z.object({
  ...commandBase,
  commandType: z.literal("complete_match"),
  outcome: performanceOutcomeSchema,
  finalResultHash: sha256HexSchema,
  authoritativelyDetermined: z.literal(true),
}).strict();
const noContestCommandSchema = z.object({ ...commandBase, commandType: z.literal("end_no_contest") }).strict();
const cancelMatchCommandSchema = z.object({ ...commandBase, commandType: z.literal("cancel_match") }).strict();
const expireMatchCommandSchema = z.object({ ...commandBase, commandType: z.literal("expire_match") }).strict();
const enforceBlockCommandSchema = z.object({
  ...commandBase,
  commandType: z.literal("enforce_block"),
  provisionalResultHash: sha256HexSchema,
  candidateOutcome: performanceOutcomeSchema.nullable(),
  riskCaseId: lowerUuidSchema,
}).strict();
const adjudicateNormalCommandSchema = z.object({
  ...commandBase,
  commandType: z.literal("adjudicate_match"),
  decision: z.literal("normal"),
  outcome: performanceOutcomeSchema,
  finalResultHash: sha256HexSchema,
  riskCaseId: lowerUuidSchema,
  authoritativelyDetermined: z.literal(true),
  adjudicationPolicyVersion: opaqueKeySchema,
}).strict();
const adjudicateForfeitCommandSchema = z.object({
  ...commandBase,
  commandType: z.literal("adjudicate_match"),
  decision: z.literal("forfeit"),
  forfeitingSeat: z.enum(["seat_a", "seat_b"]),
  finalResultHash: sha256HexSchema,
  riskCaseId: lowerUuidSchema,
  independentEvidence: z.literal(true),
  evidenceReason: z.enum(["abandonment", "fraud"]),
  adjudicationPolicyVersion: opaqueKeySchema,
}).strict();
const adjudicateNoContestCommandSchema = z.object({
  ...commandBase,
  commandType: z.literal("adjudicate_match"),
  decision: z.literal("no_contest"),
  riskCaseId: lowerUuidSchema,
  adjudicationPolicyVersion: opaqueKeySchema,
}).strict();

export const DuelCommandV1Schema = z.union([
  pairMatchCommandSchema,
  markReadyCommandSchema,
  startMatchCommandSchema,
  completeMatchCommandSchema,
  noContestCommandSchema,
  cancelMatchCommandSchema,
  expireMatchCommandSchema,
  enforceBlockCommandSchema,
  adjudicateNormalCommandSchema,
  adjudicateForfeitCommandSchema,
  adjudicateNoContestCommandSchema,
]);

export type DuelCommandV1 = z.infer<typeof DuelCommandV1Schema>;

export function buildDuelCommandCanonicalPreimageV1(rawCommand: unknown): string {
  const command = DuelCommandV1Schema.parse(rawCommand);
  return `domain=iaaprova.social.duel-command\nversion=1\nbody_jcs_b64u=${base64UrlUtf8(jcsSerializeV1(command))}\n`;
}

export function duelCommandCanonicalHashV1(rawCommand: unknown): string {
  return createHash("sha256").update(buildDuelCommandCanonicalPreimageV1(rawCommand), "utf8").digest("hex");
}

const duelEventTypeSchema = z.enum([
  "match_paired",
  "match_ready",
  "match_started",
  "match_completed",
  "match_no_contest",
  "match_cancelled",
  "match_expired",
  "match_interrupted_under_review",
  "match_block_conflict_recorded",
  "match_adjudicated",
]);

type DuelEventTypeV1 = z.infer<typeof duelEventTypeSchema>;

function eventStateIsCoherentV1(
  eventType: DuelEventTypeV1,
  matchStatus: z.infer<typeof duelStatusSchema>,
  resultStatus: "none" | "provisional" | "final",
): boolean {
  switch (eventType) {
    case "match_paired": return matchStatus === "matched" && resultStatus === "none";
    case "match_ready": return matchStatus === "ready" && resultStatus === "none";
    case "match_started": return matchStatus === "active" && resultStatus === "none";
    case "match_completed": return matchStatus === "completed" && resultStatus === "final";
    case "match_no_contest": return matchStatus === "no_contest" && resultStatus === "final";
    case "match_cancelled": return matchStatus === "cancelled" && resultStatus === "final";
    case "match_expired": return matchStatus === "expired" && resultStatus === "final";
    case "match_interrupted_under_review":
    case "match_block_conflict_recorded":
      return matchStatus === "under_review" && resultStatus === "provisional";
    case "match_adjudicated":
      return ["completed", "forfeited", "no_contest"].includes(matchStatus) && resultStatus === "final";
  }
}

export const DuelEventV1Schema = z.object({
  schemaVersion: z.literal(DUEL_EVENT_SCHEMA_VERSION),
  authority: z.literal("server"),
  eventType: duelEventTypeSchema,
  matchId: lowerUuidSchema,
  commandId: lowerUuidSchema,
  serverSeq: positiveIntegerSchema,
  stateVersion: positiveIntegerSchema,
  occurredAt: utcTimestampSchema,
  matchStatus: duelStatusSchema,
  resultStatus: z.enum(["none", "provisional", "final"]),
  publicReason: z.enum(["match_interrupted", "match_interrupted_under_review", "match_finished"]).nullable(),
}).strict().superRefine((event, context) => {
  if (event.serverSeq !== event.stateVersion) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "event_sequence_version_mismatch" });
  }
  if (!eventStateIsCoherentV1(event.eventType, event.matchStatus, event.resultStatus)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "event_state_incoherent" });
  }
  const expectedReason = event.eventType === "match_paired" || event.eventType === "match_ready" || event.eventType === "match_started"
    ? null
    : event.eventType === "match_completed" || (event.eventType === "match_adjudicated" && event.matchStatus !== "no_contest")
      ? "match_finished"
      : event.eventType === "match_interrupted_under_review" || event.eventType === "match_block_conflict_recorded"
        ? "match_interrupted_under_review"
        : "match_interrupted";
  if (event.publicReason !== expectedReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "event_public_reason_incoherent" });
  }
});

export type DuelEventV1 = z.infer<typeof DuelEventV1Schema>;

export const DuelCommandReceiptV1Schema = z.object({
  schemaVersion: z.literal(DUEL_RECEIPT_SCHEMA_VERSION),
  authority: z.literal("server"),
  commandId: lowerUuidSchema,
  requestHash: sha256HexSchema,
  commandCanonicalHash: sha256HexSchema,
  matchId: lowerUuidSchema,
  resultStateVersion: positiveIntegerSchema,
  resultStateCanonicalHash: sha256HexSchema,
  serverSeq: positiveIntegerSchema,
  ack: z.object({
    accepted: z.literal(true),
    eventType: duelEventTypeSchema,
    matchStatus: duelStatusSchema,
    resultStatus: z.enum(["none", "provisional", "final"]),
  }).strict(),
}).strict().superRefine((receipt, context) => {
  if (receipt.resultStateVersion !== receipt.serverSeq) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "receipt_sequence_version_mismatch" });
  }
  if (!eventStateIsCoherentV1(receipt.ack.eventType, receipt.ack.matchStatus, receipt.ack.resultStatus)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "receipt_ack_incoherent" });
  }
});

export type DuelCommandReceiptV1 = z.infer<typeof DuelCommandReceiptV1Schema>;

export function buildDuelStateCanonicalPreimageV1(rawState: unknown): string {
  const state = DuelStateV1Schema.parse(rawState);
  return `domain=iaaprova.social.duel-state\nversion=1\nbody_jcs_b64u=${base64UrlUtf8(jcsSerializeV1(state))}\n`;
}

export function duelStateCanonicalHashV1(rawState: unknown): string {
  return createHash("sha256").update(buildDuelStateCanonicalPreimageV1(rawState), "utf8").digest("hex");
}

export type ApplyDuelCommandInputV1 = Readonly<{
  state: unknown;
  command: unknown;
  requestHash: string;
  existingReceipt?: unknown;
}>;

const appliedDuelCommandResultV1Schema = z.object({
  schemaVersion: z.literal(DUEL_APPLY_RESULT_SCHEMA_VERSION),
  authority: z.literal("server"),
  kind: z.literal("applied"),
  state: DuelStateV1Schema,
  event: DuelEventV1Schema,
  receipt: DuelCommandReceiptV1Schema,
}).strict();

const replayedDuelCommandResultV1Schema = z.object({
  schemaVersion: z.literal(DUEL_APPLY_RESULT_SCHEMA_VERSION),
  authority: z.literal("server"),
  kind: z.literal("replay"),
  state: DuelStateV1Schema,
  event: z.null(),
  receipt: DuelCommandReceiptV1Schema,
}).strict();

export const ApplyDuelCommandResultV1Schema = z.discriminatedUnion("kind", [
  appliedDuelCommandResultV1Schema,
  replayedDuelCommandResultV1Schema,
]).superRefine((result, context) => {
  if (result.kind === "replay") {
    if (result.state.stateVersion < result.receipt.resultStateVersion
      || result.state.serverSeq < result.receipt.serverSeq
      || result.state.matchId !== result.receipt.matchId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "replay_result_incoherent" });
    }
    return;
  }
  if (result.state.matchId !== result.event.matchId
    || result.state.matchId !== result.receipt.matchId
    || result.event.commandId !== result.receipt.commandId
    || result.state.stateVersion !== result.event.stateVersion
    || result.state.stateVersion !== result.receipt.resultStateVersion
    || result.state.serverSeq !== result.event.serverSeq
    || result.state.serverSeq !== result.receipt.serverSeq
    || result.state.status !== result.event.matchStatus
    || result.state.status !== result.receipt.ack.matchStatus
    || result.state.result.status !== result.event.resultStatus
    || result.state.result.status !== result.receipt.ack.resultStatus
    || result.event.eventType !== result.receipt.ack.eventType) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "applied_result_incoherent" });
  }
});

export type ApplyDuelCommandResultV1 = Readonly<z.infer<typeof ApplyDuelCommandResultV1Schema>>;

export function createQueuedDuelStateV1(rawInput: unknown): Readonly<DuelStateV1> {
  const input = z.object({
    authority: z.literal("server"),
    matchId: lowerUuidSchema,
    rulesVersionId: lowerUuidSchema,
    rulesCanonicalHash: sha256HexSchema,
    competitionMode: z.enum(["ranked", "unranked"]),
    createdAt: utcTimestampSchema,
  }).strict().parse(rawInput);
  return deepFreeze(DuelStateV1Schema.parse({
    schemaVersion: DUEL_STATE_SCHEMA_VERSION,
    authority: "server",
    matchId: input.matchId,
    rulesVersionId: input.rulesVersionId,
    rulesCanonicalHash: input.rulesCanonicalHash,
    competitionMode: input.competitionMode,
    status: "queued",
    stateVersion: 0,
    serverSeq: 0,
    snapshotHash: null,
    result: { status: "none", outcome: null, provisionalResultHash: null, finalResultHash: null },
    riskState: "none",
    riskCaseId: null,
    blockConflictCount: 0,
    ledgerStatus: "not_applicable",
    finishReason: null,
    adjudicationPolicyVersion: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }));
}

type Transition = {
  eventType: DuelEventV1["eventType"];
  publicReason: DuelEventV1["publicReason"];
  patch: Partial<DuelStateV1>;
};

function requireStatus(state: DuelStateV1, allowed: readonly DuelStateV1["status"][]): void {
  if (!allowed.includes(state.status)) fail(`transition_not_allowed_from_${state.status}`);
}

function transitionForCommand(state: DuelStateV1, command: DuelCommandV1): Transition {
  switch (command.commandType) {
    case "pair_match":
      requireStatus(state, ["queued"]);
      return { eventType: "match_paired", publicReason: null, patch: { status: "matched", snapshotHash: command.snapshotHash } };
    case "mark_ready":
      requireStatus(state, ["matched"]);
      return { eventType: "match_ready", publicReason: null, patch: { status: "ready" } };
    case "start_match":
      requireStatus(state, ["ready"]);
      return {
        eventType: "match_started",
        publicReason: null,
        patch: { status: "active", ledgerStatus: state.competitionMode === "ranked" ? "pending" : "not_applicable" },
      };
    case "complete_match":
      requireStatus(state, ["active"]);
      if (state.riskState !== "none") fail("risk_state_blocks_completion");
      return {
        eventType: "match_completed",
        publicReason: "match_finished",
        patch: {
          status: "completed",
          result: { status: "final", outcome: command.outcome, provisionalResultHash: null, finalResultHash: command.finalResultHash },
          ledgerStatus: state.competitionMode === "ranked" ? "eligible" : "not_applicable",
          finishReason: "normal",
        },
      };
    case "end_no_contest":
      requireStatus(state, ["active"]);
      return {
        eventType: "match_no_contest",
        publicReason: "match_interrupted",
        patch: {
          status: "no_contest",
          result: { status: "final", outcome: "no_contest", provisionalResultHash: null, finalResultHash: null },
          ledgerStatus: "discarded",
          finishReason: "security_interruption",
        },
      };
    case "cancel_match":
      requireStatus(state, ["queued", "matched", "ready"]);
      return {
        eventType: "match_cancelled",
        publicReason: "match_interrupted",
        patch: {
          status: "cancelled",
          result: { status: "final", outcome: "cancelled", provisionalResultHash: null, finalResultHash: null },
          ledgerStatus: "discarded",
          finishReason: "cancelled",
        },
      };
    case "expire_match":
      requireStatus(state, ["queued", "matched", "ready"]);
      return {
        eventType: "match_expired",
        publicReason: "match_interrupted",
        patch: {
          status: "expired",
          result: { status: "final", outcome: "expired", provisionalResultHash: null, finalResultHash: null },
          ledgerStatus: "discarded",
          finishReason: "expired",
        },
      };
    case "enforce_block": {
      requireStatus(state, ["queued", "matched", "ready", "active", "under_review"]);
      if (state.status === "queued" || state.status === "matched" || state.status === "ready") {
        return {
          eventType: "match_cancelled",
          publicReason: "match_interrupted",
          patch: {
            status: "cancelled",
            result: { status: "final", outcome: "cancelled", provisionalResultHash: null, finalResultHash: null },
            ledgerStatus: "discarded",
            finishReason: "security_interruption",
            blockConflictCount: state.blockConflictCount + 1,
          },
        };
      }
      if (state.status === "active" && state.competitionMode === "unranked") {
        return {
          eventType: "match_no_contest",
          publicReason: "match_interrupted",
          patch: {
            status: "no_contest",
            result: { status: "final", outcome: "no_contest", provisionalResultHash: null, finalResultHash: null },
            ledgerStatus: "discarded",
            finishReason: "security_interruption",
            blockConflictCount: state.blockConflictCount + 1,
          },
        };
      }
      if (state.status === "under_review") {
        if (state.result.status !== "provisional"
          || !safeHexEquals(state.result.provisionalResultHash, command.provisionalResultHash)
          || state.result.outcome !== command.candidateOutcome
          || state.riskCaseId !== command.riskCaseId) {
          fail("block_conflict_snapshot_mismatch");
        }
        return {
          eventType: "match_block_conflict_recorded",
          publicReason: "match_interrupted_under_review",
          patch: { blockConflictCount: state.blockConflictCount + 1 },
        };
      }
      return {
        eventType: "match_interrupted_under_review",
        publicReason: "match_interrupted_under_review",
        patch: {
          status: "under_review",
          result: {
            status: "provisional",
            outcome: command.candidateOutcome,
            provisionalResultHash: command.provisionalResultHash,
            finalResultHash: null,
          },
          riskState: "block_conflict",
          riskCaseId: command.riskCaseId,
          ledgerStatus: "pending",
          finishReason: null,
          blockConflictCount: state.blockConflictCount + 1,
        },
      };
    }
    case "adjudicate_match": {
      requireStatus(state, ["under_review"]);
      if (state.result.status !== "provisional") fail("provisional_result_required");
      if (state.riskCaseId !== command.riskCaseId) fail("adjudication_risk_case_mismatch");
      if (command.decision === "normal") {
        if (!safeHexEquals(command.finalResultHash, state.result.provisionalResultHash)
          || state.result.outcome === null
          || command.outcome !== state.result.outcome) {
          fail("normal_adjudication_must_preserve_authoritative_result");
        }
        return {
          eventType: "match_adjudicated",
          publicReason: "match_finished",
          patch: {
            status: "completed",
            result: {
              status: "final",
              outcome: command.outcome,
              provisionalResultHash: state.result.provisionalResultHash,
              finalResultHash: command.finalResultHash,
            },
            riskState: "adjudicated",
            ledgerStatus: state.competitionMode === "ranked" ? "eligible" : "not_applicable",
            finishReason: "adjudicated_normal",
            adjudicationPolicyVersion: command.adjudicationPolicyVersion,
          },
        };
      }
      if (command.decision === "forfeit") {
        return {
          eventType: "match_adjudicated",
          publicReason: "match_finished",
          patch: {
            status: "forfeited",
            result: {
              status: "final",
              outcome: command.forfeitingSeat === "seat_a" ? "forfeit_seat_a" : "forfeit_seat_b",
              provisionalResultHash: state.result.provisionalResultHash,
              finalResultHash: command.finalResultHash,
            },
            riskState: "adjudicated",
            ledgerStatus: state.competitionMode === "ranked" ? "eligible" : "not_applicable",
            finishReason: "adjudicated_forfeit",
            adjudicationPolicyVersion: command.adjudicationPolicyVersion,
          },
        };
      }
      return {
        eventType: "match_adjudicated",
        publicReason: "match_interrupted",
        patch: {
          status: "no_contest",
          result: {
            status: "final",
            outcome: "no_contest",
            provisionalResultHash: state.result.provisionalResultHash,
            finalResultHash: null,
          },
          riskState: "adjudicated",
          ledgerStatus: "discarded",
          finishReason: "adjudicated_no_contest",
          adjudicationPolicyVersion: command.adjudicationPolicyVersion,
        },
      };
    }
  }
}

export function applyDuelCommandV1(input: ApplyDuelCommandInputV1): ApplyDuelCommandResultV1 {
  const state = DuelStateV1Schema.parse(input.state);
  const command = DuelCommandV1Schema.parse(input.command);
  const requestHash = sha256HexSchema.parse(input.requestHash);
  const commandCanonicalHash = duelCommandCanonicalHashV1(command);
  if (command.matchId !== state.matchId) fail("command_match_mismatch");

  if (input.existingReceipt !== undefined) {
    const existingReceipt = DuelCommandReceiptV1Schema.parse(input.existingReceipt);
    if (existingReceipt.commandId !== command.commandId || existingReceipt.matchId !== state.matchId) {
      fail("idempotency_receipt_command_mismatch");
    }
    if (!safeHexEquals(existingReceipt.requestHash, requestHash)) fail("idempotency_conflict");
    if (!safeHexEquals(existingReceipt.commandCanonicalHash, commandCanonicalHash)) fail("idempotency_command_conflict");
    if (state.stateVersion < existingReceipt.resultStateVersion || state.serverSeq < existingReceipt.serverSeq) {
      fail("idempotency_receipt_ahead_of_state");
    }
    if (state.stateVersion === existingReceipt.resultStateVersion
      && !safeHexEquals(existingReceipt.resultStateCanonicalHash, duelStateCanonicalHashV1(state))) {
      fail("idempotency_result_state_tampered");
    }
    return deepFreeze(ApplyDuelCommandResultV1Schema.parse({
      schemaVersion: DUEL_APPLY_RESULT_SCHEMA_VERSION,
      authority: "server",
      kind: "replay",
      state,
      event: null,
      receipt: existingReceipt,
    }));
  }

  if (command.expectedStateVersion !== state.stateVersion) fail("state_version_conflict");
  if (Date.parse(command.receivedAt) < Date.parse(state.updatedAt)) fail("server_time_must_be_monotonic");

  const transition = transitionForCommand(state, command);
  const nextState = DuelStateV1Schema.parse({
    ...state,
    ...transition.patch,
    stateVersion: state.stateVersion + 1,
    serverSeq: state.serverSeq + 1,
    updatedAt: command.receivedAt,
  });
  const event = DuelEventV1Schema.parse({
    schemaVersion: DUEL_EVENT_SCHEMA_VERSION,
    authority: "server",
    eventType: transition.eventType,
    matchId: state.matchId,
    commandId: command.commandId,
    serverSeq: nextState.serverSeq,
    stateVersion: nextState.stateVersion,
    occurredAt: command.receivedAt,
    matchStatus: nextState.status,
    resultStatus: nextState.result.status,
    publicReason: transition.publicReason,
  });
  const receipt = DuelCommandReceiptV1Schema.parse({
    schemaVersion: DUEL_RECEIPT_SCHEMA_VERSION,
    authority: "server",
    commandId: command.commandId,
    requestHash,
    commandCanonicalHash,
    matchId: state.matchId,
    resultStateVersion: nextState.stateVersion,
    resultStateCanonicalHash: duelStateCanonicalHashV1(nextState),
    serverSeq: nextState.serverSeq,
    ack: {
      accepted: true,
      eventType: event.eventType,
      matchStatus: nextState.status,
      resultStatus: nextState.result.status,
    },
  });
  return deepFreeze(ApplyDuelCommandResultV1Schema.parse({
    schemaVersion: DUEL_APPLY_RESULT_SCHEMA_VERSION,
    authority: "server",
    kind: "applied",
    state: nextState,
    event,
    receipt,
  }));
}
