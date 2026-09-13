import {
  DUEL_COMMAND_SCHEMA_VERSION,
  DUEL_RULES_SCHEMA_VERSION,
  SOCIAL_REQUEST_SCHEMA_VERSION,
} from "./index.ts";

function deepFreezeVector<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (typeof value !== "object" || value === null) return value as Readonly<T>;
  if (seen.has(value)) return value as Readonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreezeVector(child, seen);
  return Object.freeze(value);
}

const REQUEST_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const INVITE_KEY_HEX = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";

export const SOCIAL_ENGINE_GOLDEN_VECTORS_V1 = deepFreezeVector({
  schemaVersion: "iaaprova.social.golden-vectors.v1",
  keys: {
    requestHashKeyHex: REQUEST_KEY_HEX,
    requestHashKeyVersion: "v7",
    inviteDigestKeyHex: INVITE_KEY_HEX,
    inviteDigestKeyVersion: "v3",
  },
  inviteRequest: {
    input: {
      schemaVersion: SOCIAL_REQUEST_SCHEMA_VERSION,
      authority: "server",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      operation: "social_friend_request_create",
      method: "POST",
      routeTemplate: "/api/v1/social/friend-requests",
      resourceScope: "-",
      body: { inviteCode: "ABCD2345EFGH6789JKLM" },
    },
    expectedInvitePreimage: "domain=iaaprova.social.invite\nversion=1\ncode=ABCD2345EFGH6789JKLM\n",
    expectedInviteDigest: "c79feac52e68dbd031c2919aa562b88e1fd46be9fe701b0c7ed74f6fe7ad9f0f",
    expectedBodyJcs: "{\"inviteCodeDigest\":\"c79feac52e68dbd031c2919aa562b88e1fd46be9fe701b0c7ed74f6fe7ad9f0f\",\"inviteCodeDigestKeyVersion\":\"v3\"}",
    expectedBodyJcsBase64Url: "eyJpbnZpdGVDb2RlRGlnZXN0IjoiYzc5ZmVhYzUyZTY4ZGJkMDMxYzI5MTlhYTU2MmI4OGUxZmQ0NmJlOWZlNzAxYjBjN2VkNzRmNmZlN2FkOWYwZiIsImludml0ZUNvZGVEaWdlc3RLZXlWZXJzaW9uIjoidjMifQ",
    expectedRequestPreimage: "domain=iaaprova.social.request\nversion=1\noperation=social_friend_request_create\nactor_user_id=11111111-1111-4111-8111-111111111111\nmethod=POST\nroute_template=/api/v1/social/friend-requests\nresource_scope=-\nbody_jcs_b64u=eyJpbnZpdGVDb2RlRGlnZXN0IjoiYzc5ZmVhYzUyZTY4ZGJkMDMxYzI5MTlhYTU2MmI4OGUxZmQ0NmJlOWZlNzAxYjBjN2VkNzRmNmZlN2FkOWYwZiIsImludml0ZUNvZGVEaWdlc3RLZXlWZXJzaW9uIjoidjMifQ\n",
    expectedRequestHash: "20668fc70d3e288d8e4c0ab296529cf1d8676aeb44633615e5b93c374becd9b5",
  },
  unicodeReportRequest: {
    input: {
      schemaVersion: SOCIAL_REQUEST_SCHEMA_VERSION,
      authority: "server",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      operation: "social_report_create",
      method: "POST",
      routeTemplate: "/api/v1/social/reports",
      resourceScope: "-",
      body: {
        targetType: "user",
        targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reason: "abuse",
        note: "Cafe\u0301",
      },
    },
    expectedBodyJcs: "{\"note\":\"Caf\u00e9\",\"reason\":\"abuse\",\"targetId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"targetType\":\"user\"}",
    expectedBodyJcsBase64Url: "eyJub3RlIjoiQ2Fmw6kiLCJyZWFzb24iOiJhYnVzZSIsInRhcmdldElkIjoiYWFhYWFhYWEtYWFhYS00YWFhLThhYWEtYWFhYWFhYWFhYWFhIiwidGFyZ2V0VHlwZSI6InVzZXIifQ",
    expectedRequestPreimage: "domain=iaaprova.social.request\nversion=1\noperation=social_report_create\nactor_user_id=11111111-1111-4111-8111-111111111111\nmethod=POST\nroute_template=/api/v1/social/reports\nresource_scope=-\nbody_jcs_b64u=eyJub3RlIjoiQ2Fmw6kiLCJyZWFzb24iOiJhYnVzZSIsInRhcmdldElkIjoiYWFhYWFhYWEtYWFhYS00YWFhLThhYWEtYWFhYWFhYWFhYWFhIiwidGFyZ2V0VHlwZSI6InVzZXIifQ\n",
    expectedRequestHash: "d44df4cc3d569ba536611874103ebe6a7c7fa0aede84fa5d9489027cd9101f8f",
  },
  duelRules: {
    draft: {
      schemaVersion: DUEL_RULES_SCHEMA_VERSION,
      authority: "server",
      rulesVersionId: "66666666-6666-4666-8666-666666666666",
      productId: "77777777-7777-4777-8777-777777777777",
      examVersionId: "88888888-8888-4888-8888-888888888888",
      roundCount: 10,
      roundDurationSeconds: 60,
      scoring: { correctPoints: 1, incorrectPoints: 0, unansweredPoints: 0, tieBreak: "draw" },
      rankedEligiblePerIsoWeek: { free: 3, pro: 3 },
      freeTotalDuelsPerIsoWeek: 3,
      proUnrankedPracticePerIsoWeek: null,
      quotaWindow: { kind: "iso_week_utc", weekStarts: "monday", startsAt: "00:00:00Z" },
      consumption: {
        consumeWhen: "match_active",
        restituteWhen: ["cancelled", "no_contest"],
        requiresNoParticipantFault: true,
      },
      publishedAt: "2026-09-07T00:00:00.000Z",
    },
    expectedCanonicalHash: "f11efe72afc408fc5d60579480f3674dcca75e83906605efebf296ee79620d58",
  },
  pairCommand: {
    input: {
      schemaVersion: DUEL_COMMAND_SCHEMA_VERSION,
      authority: "server",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      matchId: "22222222-2222-4222-8222-222222222222",
      expectedStateVersion: 0,
      receivedAt: "2026-09-07T00:00:01.000Z",
      commandType: "pair_match",
      snapshotHash: "abababababababababababababababababababababababababababababababab",
    },
    expectedCanonicalHash: "87f4860a0b7e1596b888f31aee7e6ac3679298b941eacb0fdac75d5881b0826a",
  },
} as const);

export type SocialEngineGoldenVectorsV1 = typeof SOCIAL_ENGINE_GOLDEN_VECTORS_V1;
