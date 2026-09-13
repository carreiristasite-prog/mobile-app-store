import assert from "node:assert/strict";
import { test } from "node:test";

import { SOCIAL_ENGINE_GOLDEN_VECTORS_V1 } from "./golden-vectors.ts";
import {
  ApplyDuelCommandResultV1Schema,
  CANONICAL_JSON_V1_LIMITS,
  CanonicalRequestHashV1Schema,
  CanonicalSocialRequestV1Schema,
  DUEL_COMMAND_SCHEMA_VERSION,
  DUEL_QUOTA_SCHEMA_VERSION,
  DUEL_RECEIPT_SCHEMA_VERSION,
  DuelCommandReceiptV1Schema,
  DuelCommandV1Schema,
  DuelQuotaDecisionV1Schema,
  DuelRulesVersionV1Schema,
  DuelStateV1Schema,
  SocialEngineError,
  applyDuelCommandV1,
  buildCanonicalRequestHashV1,
  buildDuelCommandCanonicalPreimageV1,
  buildInviteDigestPreimageV1,
  createDuelRulesVersionV1,
  createQueuedDuelStateV1,
  digestInviteCodeV1,
  duelCommandCanonicalHashV1,
  duelQuotaLedgerEffectV1,
  evaluateDuelQuotaV1,
  isoWeekUtcWindowV1,
  jcsSerializeV1,
  parseAndVerifyDuelRulesVersionV1,
} from "./index.ts";

const vectors = SOCIAL_ENGINE_GOLDEN_VECTORS_V1;
const requestHashKey = Buffer.from(vectors.keys.requestHashKeyHex, "hex");
const inviteDigestKey = Buffer.from(vectors.keys.inviteDigestKeyHex, "hex");
const requestKeys = {
  requestHashKey,
  requestHashKeyVersion: vectors.keys.requestHashKeyVersion,
  inviteDigestKey,
  inviteDigestKeyVersion: vectors.keys.inviteDigestKeyVersion,
};

const MATCH_ID = "22222222-2222-4222-8222-222222222222";
const RULES_ID = "66666666-6666-4666-8666-666666666666";
const RISK_CASE_ID = "99999999-9999-4999-8999-999999999999";
const HASH_A = "aa".repeat(32);
const HASH_B = "bb".repeat(32);
const HASH_C = "cc".repeat(32);
const REQUEST_HASH = "01".repeat(32);

function socialError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof SocialEngineError && error.code === code;
}

function queueState(competitionMode: "ranked" | "unranked" = "ranked") {
  return createQueuedDuelStateV1({
    authority: "server",
    matchId: MATCH_ID,
    rulesVersionId: RULES_ID,
    rulesCanonicalHash: vectors.duelRules.expectedCanonicalHash,
    competitionMode,
    createdAt: "2026-09-07T00:00:00.000Z",
  });
}

function commandBase(commandId: string, expectedStateVersion: number, receivedAt: string) {
  return {
    schemaVersion: DUEL_COMMAND_SCHEMA_VERSION,
    authority: "server" as const,
    commandId,
    matchId: MATCH_ID,
    expectedStateVersion,
    receivedAt,
  };
}

function buildActiveState(competitionMode: "ranked" | "unranked" = "ranked") {
  const paired = applyDuelCommandV1({
    state: queueState(competitionMode),
    command: vectors.pairCommand.input,
    requestHash: REQUEST_HASH,
  });
  const ready = applyDuelCommandV1({
    state: paired.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", 1, "2026-09-07T00:00:02.000Z"),
      commandType: "mark_ready",
    },
    requestHash: "02".repeat(32),
  });
  const active = applyDuelCommandV1({
    state: ready.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", 2, "2026-09-07T00:00:03.000Z"),
      commandType: "start_match",
    },
    requestHash: "03".repeat(32),
  });
  return { paired, ready, active };
}

test("JCS v1 ordena propriedades, normaliza strings/chaves NFC e preserva null versus ausente", () => {
  assert.equal(
    jcsSerializeV1({ z: [null, "Cafe\u0301"], "e\u0301": "valor", a: -0 }),
    "{\"a\":0,\"z\":[null,\"Caf\u00e9\"],\"\u00e9\":\"valor\"}",
  );
  assert.notEqual(jcsSerializeV1({ note: null }), jcsSerializeV1({}));
  assert.throws(() => jcsSerializeV1({ "e\u0301": 1, "\u00e9": 2 }), socialError("jcs_nfc_key_collision"));
  assert.throws(() => jcsSerializeV1("\ud800"), socialError("jcs_invalid_unicode"));
});

test("JCS v1 reproduz o vetor de serialização RFC 8785", () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
    string: "\u20ac$\u000f\nA'B\"\\\"/",
    literals: [null, true, false],
  };
  const expected = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\"/"}`;
  assert.equal(jcsSerializeV1(input), expected);
});

test("JCS v1 rejeita ciclos, arrays esparsos/extras e limites excessivos", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => jcsSerializeV1(cyclic), socialError("jcs_cycle"));

  const sparse = new Array(2);
  sparse[0] = "present";
  assert.throws(() => jcsSerializeV1(sparse), socialError("jcs_sparse_array"));

  const extra = [1] as number[] & { extra?: boolean };
  extra.extra = true;
  assert.throws(() => jcsSerializeV1(extra), socialError("jcs_array_extra_property"));

  const accessor: unknown[] = [];
  Object.defineProperty(accessor, "0", { enumerable: true, get: () => "value" });
  Object.defineProperty(accessor, "length", { value: 1 });
  assert.throws(() => jcsSerializeV1(accessor), socialError("jcs_array_accessor_not_supported"));

  let tooDeep: unknown = null;
  for (let index = 0; index <= CANONICAL_JSON_V1_LIMITS.maxDepth; index += 1) tooDeep = [tooDeep];
  assert.throws(() => jcsSerializeV1(tooDeep), socialError("jcs_max_depth_exceeded"));
  assert.throws(
    () => jcsSerializeV1(new Array(CANONICAL_JSON_V1_LIMITS.maxArrayLength + 1).fill(null)),
    socialError("jcs_array_too_large"),
  );
  assert.throws(
    () => jcsSerializeV1("x".repeat(CANONICAL_JSON_V1_LIMITS.maxStringUtf8Bytes + 1)),
    socialError("jcs_string_too_large"),
  );
});

test("vetor dourado de convite fixa bytes, LF final, digest e HMAC do request sem reter raw", () => {
  const vector = vectors.inviteRequest;
  assert.equal(buildInviteDigestPreimageV1(vector.input.body.inviteCode), vector.expectedInvitePreimage);
  assert.equal(Buffer.from(vector.expectedInvitePreimage).at(-1), 0x0a);
  assert.equal(digestInviteCodeV1(vector.input.body.inviteCode, inviteDigestKey), vector.expectedInviteDigest);

  const actual = buildCanonicalRequestHashV1(vector.input, requestKeys);
  assert.equal(actual.bodyJcs, vector.expectedBodyJcs);
  assert.equal(actual.bodyJcsBase64Url, vector.expectedBodyJcsBase64Url);
  assert.equal(actual.preimage, vector.expectedRequestPreimage);
  assert.equal(Buffer.from(actual.preimage).at(-1), 0x0a);
  assert.equal(actual.requestHash, vector.expectedRequestHash);
  assert.equal(actual.requestHashKeyVersion, "v7");
  assert.equal(JSON.stringify(actual).includes(vector.input.body.inviteCode), false);
  assert.equal(Object.isFrozen(actual), true);
});

test("vetor Unicode prova NFC e rotação muda hash/version sem ambiguidade", () => {
  const vector = vectors.unicodeReportRequest;
  const actual = buildCanonicalRequestHashV1(vector.input, requestKeys);
  assert.equal(actual.bodyJcs, vector.expectedBodyJcs);
  assert.equal(actual.bodyJcsBase64Url, vector.expectedBodyJcsBase64Url);
  assert.equal(actual.preimage, vector.expectedRequestPreimage);
  assert.equal(actual.requestHash, vector.expectedRequestHash);

  const rotated = buildCanonicalRequestHashV1(vector.input, {
    ...requestKeys,
    requestHashKey: Buffer.alloc(32, 0x5a),
    requestHashKeyVersion: "v8",
  });
  assert.notEqual(rotated.requestHash, actual.requestHash);
  assert.equal(rotated.requestHashKeyVersion, "v8");
});

test("request canônico rejeita campos client-owned e contratos de resultado são estritos", () => {
  assert.throws(() => CanonicalSocialRequestV1Schema.parse({
    ...vectors.inviteRequest.input,
    score: 999,
  }));
  assert.throws(() => CanonicalSocialRequestV1Schema.parse({
    ...vectors.inviteRequest.input,
    authority: "client",
  }));
  assert.throws(() => CanonicalRequestHashV1Schema.parse({
    ...buildCanonicalRequestHashV1(vectors.inviteRequest.input, requestKeys),
    unexpected: true,
  }));
  assert.throws(() => DuelQuotaDecisionV1Schema.parse({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    allowed: true,
    reason: "ranked_weekly_limit_reached",
    window: { start: "2026-09-07T00:00:00.000Z", end: "2026-09-14T00:00:00.000Z" },
    rankedRemaining: 0,
    freeTotalRemaining: 0,
    unrankedPlanRemaining: null,
  }));
});

test("rules version é estrita, imutável e detecta qualquer adulteração", () => {
  const rules = createDuelRulesVersionV1(vectors.duelRules.draft);
  assert.equal(rules.canonicalHash, vectors.duelRules.expectedCanonicalHash);
  assert.equal(Object.isFrozen(rules), true);
  assert.equal(Object.isFrozen(rules.scoring), true);
  assert.throws(() => {
    (rules.scoring as { correctPoints: number }).correctPoints = 2;
  });
  assert.throws(() => DuelRulesVersionV1Schema.parse({ ...rules, remoteOverride: true }));
  assert.throws(
    () => parseAndVerifyDuelRulesVersionV1({ ...rules, roundCount: 11 }),
    socialError("duel_rules_hash_mismatch"),
  );
});

test("vetor dourado de comando fixa canonical hash independente da ordem de propriedades", () => {
  const vector = vectors.pairCommand;
  assert.equal(duelCommandCanonicalHashV1(vector.input), vector.expectedCanonicalHash);
  assert.equal(Buffer.from(buildDuelCommandCanonicalPreimageV1(vector.input)).at(-1), 0x0a);
  const reordered = {
    snapshotHash: vector.input.snapshotHash,
    commandType: vector.input.commandType,
    receivedAt: vector.input.receivedAt,
    expectedStateVersion: vector.input.expectedStateVersion,
    matchId: vector.input.matchId,
    commandId: vector.input.commandId,
    authority: vector.input.authority,
    schemaVersion: vector.input.schemaVersion,
  };
  assert.equal(duelCommandCanonicalHashV1(reordered), vector.expectedCanonicalHash);
});

test("janela ISO UTC fecha na segunda seguinte inclusive na virada do ano", () => {
  assert.deepEqual(isoWeekUtcWindowV1("2026-09-13T23:59:59.999Z"), {
    start: "2026-09-07T00:00:00.000Z",
    end: "2026-09-14T00:00:00.000Z",
  });
  assert.deepEqual(isoWeekUtcWindowV1("2026-09-14T00:00:00.000Z"), {
    start: "2026-09-14T00:00:00.000Z",
    end: "2026-09-21T00:00:00.000Z",
  });
  assert.deepEqual(isoWeekUtcWindowV1("2027-01-01T12:00:00.000Z"), {
    start: "2026-12-28T00:00:00.000Z",
    end: "2027-01-04T00:00:00.000Z",
  });
});

test("Free e Pro têm exatamente três ranked; unranked é ilimitado somente para Pro", () => {
  const rules = createDuelRulesVersionV1(vectors.duelRules.draft);
  const common = {
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server" as const,
    now: "2026-09-10T12:00:00.000Z",
    windowUsage: {
      windowStart: "2026-09-07T00:00:00.000Z",
      windowEnd: "2026-09-14T00:00:00.000Z",
      rankedConsumed: 0,
      freeTotalConsumed: 0,
    },
  };
  assert.equal(evaluateDuelQuotaV1(rules, { ...common, plan: "free", competitionMode: "ranked" }).allowed, true);
  assert.equal(evaluateDuelQuotaV1(rules, {
    ...common,
    plan: "free",
    competitionMode: "ranked",
    windowUsage: { ...common.windowUsage, rankedConsumed: 3, freeTotalConsumed: 3 },
  }).reason, "ranked_weekly_limit_reached");
  assert.equal(evaluateDuelQuotaV1(rules, {
    ...common,
    plan: "pro",
    competitionMode: "ranked",
    windowUsage: { ...common.windowUsage, rankedConsumed: 3 },
  }).reason, "ranked_weekly_limit_reached");
  assert.equal(evaluateDuelQuotaV1(rules, { ...common, plan: "free", competitionMode: "unranked" }).reason, "unranked_requires_pro");
  const proPractice = evaluateDuelQuotaV1(rules, {
    ...common,
    plan: "pro",
    competitionMode: "unranked",
    windowUsage: { ...common.windowUsage, rankedConsumed: 99, freeTotalConsumed: 99 },
  });
  assert.equal(proPractice.allowed, true);
  assert.equal(proPractice.unrankedPlanRemaining, null);
  assert.throws(
    () => evaluateDuelQuotaV1(rules, {
      ...common,
      plan: "free",
      competitionMode: "ranked",
      windowUsage: { ...common.windowUsage, windowStart: "2026-09-08T00:00:00.000Z" },
    }),
    socialError("quota_window_mismatch"),
  );
});

test("consumo ocorre no active e restitui cancelled/no_contest sem culpa", () => {
  const consumed = duelQuotaLedgerEffectV1({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    plan: "free",
    competitionMode: "ranked",
    previousStatus: "ready",
    nextStatus: "active",
    participantFault: false,
  });
  assert.deepEqual(
    { ranked: consumed.rankedConsumedDelta, total: consumed.freeTotalConsumedDelta, reason: consumed.reason },
    { ranked: 1, total: 1, reason: "match_started" },
  );
  const restored = duelQuotaLedgerEffectV1({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    plan: "pro",
    competitionMode: "ranked",
    previousStatus: "under_review",
    nextStatus: "no_contest",
    participantFault: false,
  });
  assert.equal(restored.rankedConsumedDelta, -1);
  assert.equal(restored.reason, "eligible_restitution");
  const faulted = duelQuotaLedgerEffectV1({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    plan: "pro",
    competitionMode: "ranked",
    previousStatus: "active",
    nextStatus: "no_contest",
    participantFault: true,
  });
  assert.equal(faulted.rankedConsumedDelta, 0);
  assert.equal(faulted.reason, "no_quota_change");
  const unlimited = duelQuotaLedgerEffectV1({
    schemaVersion: DUEL_QUOTA_SCHEMA_VERSION,
    authority: "server",
    plan: "pro",
    competitionMode: "unranked",
    previousStatus: "ready",
    nextStatus: "active",
    participantFault: false,
  });
  assert.equal(unlimited.reason, "no_quota_change");
});

test("reducer aplica transições autoritativas e produz estado/evento/receipt imutáveis", () => {
  const { active } = buildActiveState("ranked");
  const completed = applyDuelCommandV1({
    state: active.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", 3, "2026-09-07T00:00:04.000Z"),
      commandType: "complete_match",
      outcome: "seat_a_win",
      finalResultHash: HASH_A,
      authoritativelyDetermined: true,
    },
    requestHash: "04".repeat(32),
  });
  assert.equal(completed.state.status, "completed");
  assert.equal(completed.state.ledgerStatus, "eligible");
  assert.equal(completed.event?.eventType, "match_completed");
  assert.equal(completed.receipt.schemaVersion, DUEL_RECEIPT_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(completed), true);
  assert.equal(Object.isFrozen(completed.state.result), true);
  assert.doesNotThrow(() => ApplyDuelCommandResultV1Schema.parse(completed));
  assert.throws(() => DuelCommandV1Schema.parse({
    ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", 4, "2026-09-07T00:00:05.000Z"),
    commandType: "complete_match",
    outcome: "seat_a_win",
    finalResultHash: HASH_A,
    authoritativelyDetermined: true,
    score: 999,
  }));
});

test("replay idêntico reproduz ACK sem mutar; request, comando e estado adulterados falham fechados", () => {
  const state = queueState();
  const applied = applyDuelCommandV1({ state, command: vectors.pairCommand.input, requestHash: REQUEST_HASH });
  const replayed = applyDuelCommandV1({
    state: applied.state,
    command: vectors.pairCommand.input,
    requestHash: REQUEST_HASH,
    existingReceipt: applied.receipt,
  });
  assert.equal(replayed.kind, "replay");
  assert.equal(replayed.event, null);
  assert.deepEqual(replayed.receipt, applied.receipt);
  assert.equal(replayed.state.stateVersion, 1);
  assert.throws(() => applyDuelCommandV1({
    state: applied.state,
    command: vectors.pairCommand.input,
    requestHash: "ff".repeat(32),
    existingReceipt: applied.receipt,
  }), socialError("idempotency_conflict"));
  assert.throws(() => applyDuelCommandV1({
    state: applied.state,
    command: { ...vectors.pairCommand.input, snapshotHash: HASH_C },
    requestHash: REQUEST_HASH,
    existingReceipt: applied.receipt,
  }), socialError("idempotency_command_conflict"));
  assert.throws(() => applyDuelCommandV1({
    state: { ...applied.state, blockConflictCount: 1 },
    command: vectors.pairCommand.input,
    requestHash: REQUEST_HASH,
    existingReceipt: applied.receipt,
  }), socialError("idempotency_result_state_tampered"));
  assert.throws(() => DuelCommandReceiptV1Schema.parse({ ...applied.receipt, extra: true }));
});

test("replay antigo em estado posterior preserva estado atual e ACK original", () => {
  const { paired, ready } = buildActiveState();
  const replayed = applyDuelCommandV1({
    state: ready.state,
    command: vectors.pairCommand.input,
    requestHash: REQUEST_HASH,
    existingReceipt: paired.receipt,
  });
  assert.equal(replayed.kind, "replay");
  assert.equal(replayed.state.status, "ready");
  assert.equal(replayed.receipt.ack.eventType, "match_paired");
});

test("block em ranked ativo congela provisional/under_review sem auto-forfeit", () => {
  const { active } = buildActiveState("ranked");
  const blockCommand = {
    ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", 3, "2026-09-07T00:00:04.000Z"),
    commandType: "enforce_block" as const,
    provisionalResultHash: HASH_B,
    candidateOutcome: "draw" as const,
    riskCaseId: RISK_CASE_ID,
  };
  const held = applyDuelCommandV1({ state: active.state, command: blockCommand, requestHash: "04".repeat(32) });
  assert.equal(held.state.status, "under_review");
  assert.equal(held.state.result.status, "provisional");
  assert.equal(held.state.result.outcome, "draw");
  assert.equal(held.state.ledgerStatus, "pending");
  assert.equal(held.state.riskState, "block_conflict");
  assert.equal(held.state.riskCaseId, RISK_CASE_ID);
  assert.equal(held.event?.publicReason, "match_interrupted_under_review");

  const repeated = applyDuelCommandV1({
    state: held.state,
    command: {
      ...blockCommand,
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
      expectedStateVersion: 4,
      receivedAt: "2026-09-07T00:00:05.000Z",
    },
    requestHash: "05".repeat(32),
  });
  assert.equal(repeated.state.status, "under_review");
  assert.equal(repeated.state.blockConflictCount, 2);
  assert.notEqual(repeated.state.status, "forfeited");
  assert.throws(() => applyDuelCommandV1({
    state: repeated.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", 5, "2026-09-07T00:00:06.000Z"),
      commandType: "complete_match",
      outcome: "seat_a_win",
      finalResultHash: HASH_A,
      authoritativelyDetermined: true,
    },
    requestHash: "06".repeat(32),
  }), socialError("transition_not_allowed_from_under_review"));
});

test("adjudicação normal preserva resultado; forfeit exige evidência independente e case correto", () => {
  const { active } = buildActiveState("ranked");
  const held = applyDuelCommandV1({
    state: active.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", 3, "2026-09-07T00:00:04.000Z"),
      commandType: "enforce_block",
      provisionalResultHash: HASH_B,
      candidateOutcome: "draw",
      riskCaseId: RISK_CASE_ID,
    },
    requestHash: "04".repeat(32),
  });
  assert.throws(() => applyDuelCommandV1({
    state: held.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", 4, "2026-09-07T00:00:05.000Z"),
      commandType: "adjudicate_match",
      decision: "normal",
      outcome: "seat_a_win",
      finalResultHash: HASH_A,
      riskCaseId: RISK_CASE_ID,
      authoritativelyDetermined: true,
      adjudicationPolicyVersion: "policy.v1",
    },
    requestHash: "05".repeat(32),
  }), socialError("normal_adjudication_must_preserve_authoritative_result"));
  assert.throws(() => applyDuelCommandV1({
    state: held.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", 4, "2026-09-07T00:00:05.000Z"),
      commandType: "adjudicate_match",
      decision: "no_contest",
      riskCaseId: "99999999-9999-4999-8999-999999999998",
      adjudicationPolicyVersion: "policy.v1",
    },
    requestHash: "05".repeat(32),
  }), socialError("adjudication_risk_case_mismatch"));
  assert.throws(() => DuelCommandV1Schema.parse({
    ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", 4, "2026-09-07T00:00:05.000Z"),
    commandType: "adjudicate_match",
    decision: "forfeit",
    forfeitingSeat: "seat_b",
    finalResultHash: HASH_C,
    riskCaseId: RISK_CASE_ID,
    independentEvidence: false,
    evidenceReason: "fraud",
    adjudicationPolicyVersion: "policy.v1",
  }));

  const adjudicated = applyDuelCommandV1({
    state: held.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", 4, "2026-09-07T00:00:05.000Z"),
      commandType: "adjudicate_match",
      decision: "normal",
      outcome: "draw",
      finalResultHash: HASH_B,
      riskCaseId: RISK_CASE_ID,
      authoritativelyDetermined: true,
      adjudicationPolicyVersion: "policy.v1",
    },
    requestHash: "05".repeat(32),
  });
  assert.equal(adjudicated.state.status, "completed");
  assert.equal(adjudicated.state.riskState, "adjudicated");
  assert.equal(adjudicated.state.adjudicationPolicyVersion, "policy.v1");
  assert.equal(adjudicated.state.ledgerStatus, "eligible");
});

test("block pre-start cancela e block unranked ativo termina no_contest sem revelar direção", () => {
  const preStart = applyDuelCommandV1({
    state: queueState("ranked"),
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", 0, "2026-09-07T00:00:01.000Z"),
      commandType: "enforce_block",
      provisionalResultHash: HASH_A,
      candidateOutcome: null,
      riskCaseId: RISK_CASE_ID,
    },
    requestHash: REQUEST_HASH,
  });
  assert.equal(preStart.state.status, "cancelled");
  assert.equal(preStart.event?.publicReason, "match_interrupted");

  const { active } = buildActiveState("unranked");
  const interrupted = applyDuelCommandV1({
    state: active.state,
    command: {
      ...commandBase("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", 3, "2026-09-07T00:00:04.000Z"),
      commandType: "enforce_block",
      provisionalResultHash: HASH_A,
      candidateOutcome: null,
      riskCaseId: RISK_CASE_ID,
    },
    requestHash: "04".repeat(32),
  });
  assert.equal(interrupted.state.status, "no_contest");
  assert.equal(interrupted.state.ledgerStatus, "discarded");
  assert.equal(interrupted.event?.publicReason, "match_interrupted");
  assert.equal(JSON.stringify(interrupted.event).includes("block"), false);
});

test("schemas de estado/receipt rejeitam impossíveis e campos desconhecidos", () => {
  const state = queueState();
  assert.throws(() => DuelStateV1Schema.parse({ ...state, stateVersion: 1 }));
  assert.throws(() => DuelStateV1Schema.parse({ ...state, unexpected: true }));
  assert.throws(() => DuelCommandReceiptV1Schema.parse({
    schemaVersion: DUEL_RECEIPT_SCHEMA_VERSION,
    authority: "server",
    commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    requestHash: REQUEST_HASH,
    commandCanonicalHash: HASH_A,
    matchId: MATCH_ID,
    resultStateVersion: 1,
    resultStateCanonicalHash: HASH_B,
    serverSeq: 1,
    ack: { accepted: true, eventType: "match_paired", matchStatus: "queued", resultStatus: "none", score: 10 },
  }));
});
