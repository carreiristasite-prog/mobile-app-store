import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  compileSimulationBlueprintRules,
  computeSimulationResult,
  createSimulationPresentation,
  createSimulationSnapshot,
  createSimulationState,
  finishSimulationAtTime,
  SIMULATION_RULES_VERSION,
  SimulationBlueprintError,
  submitSimulationAnswer,
  type SimulationBlueprintRulesV1,
  type SimulationQuestionInput,
  type SimulationSnapshot,
  type SimulationState,
} from "./simulation-blueprint.ts";

const START = 1_700_000_000_000;

function canonicalizeForTest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForTest);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalizeForTest(record[key])]));
}

function rehashSnapshot(value: SimulationSnapshot): void {
  const mutable = value as unknown as Record<string, unknown>;
  const { snapshotHash: _ignored, ...content } = mutable;
  mutable.snapshotHash = createHash("sha256").update(JSON.stringify(canonicalizeForTest(content))).digest("hex");
}

function rules(overrides: Partial<SimulationBlueprintRulesV1> = {}): SimulationBlueprintRulesV1 {
  return {
    schemaVersion: SIMULATION_RULES_VERSION,
    questionCount: 3,
    durationMinutes: 60,
    scoring: {
      model: "weighted-sum.v1",
      rounding: { decimalPlaces: 2, mode: "half-away-from-zero" },
      aggregateFloor: { policy: "none" },
    },
    subjects: [
      {
        subjectId: "portugues",
        questionCount: 2,
        correctPoints: "1",
        weight: "2",
        incorrect: { policy: "penalty", penaltyPoints: "0.25" },
        unanswered: { policy: "zero" },
      },
      {
        subjectId: "matematica",
        questionCount: 1,
        correctPoints: "2.5",
        weight: "1.2",
        incorrect: { policy: "zero" },
        unanswered: { policy: "zero" },
      },
    ],
    ...overrides,
  };
}

function questions(): SimulationQuestionInput[] {
  return [
    { questionVersionId: "q-port-1-v3", subjectId: "portugues", optionIds: ["a", "b", "c", "d"], correctOptionId: "b" },
    { questionVersionId: "q-mat-1-v2", subjectId: "matematica", optionIds: ["a", "b", "c", "d"], correctOptionId: "d" },
    { questionVersionId: "q-port-2-v1", subjectId: "portugues", optionIds: ["a", "b", "c", "d"], correctOptionId: "a" },
  ];
}

function snapshot(customRules: unknown = rules(), customQuestions = questions(), startedAtMs = START): SimulationSnapshot {
  return createSimulationSnapshot({
    sessionId: "sim-1",
    blueprintVersionId: "edital-2026-v4",
    rules: customRules,
    startedAtMs,
    questions: customQuestions,
  });
}

function answer(
  currentSnapshot: SimulationSnapshot,
  state: SimulationState,
  questionVersionId: string,
  selectedOptionId: string,
  sequence: number,
) {
  return submitSimulationAnswer(currentSnapshot, state, {
    idempotencyKey: `key-${sequence}`,
    questionVersionId,
    selectedOptionId,
    receivedAtMs: START + sequence * 1_000,
  });
}

test("rules are strict, versioned, canonicalized and immutable", () => {
  const compiled = compileSimulationBlueprintRules({
    ...rules(),
    subjects: rules().subjects.map((subject) => ({
      ...subject,
      correctPoints: subject.correctPoints === "1" ? "1.000000" : "2.500000",
    })),
  });
  assert.equal(compiled.schemaVersion, SIMULATION_RULES_VERSION);
  assert.deepEqual(compiled.subjects.map((subject) => subject.correctPoints), ["1", "2.5"]);
  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(compiled.subjects), true);
  assert.equal(Object.isFrozen(compiled.subjects[0].incorrect), true);
});

test("rules reject unknown versions, missing scoring declarations and unknown fields", () => {
  assert.throws(
    () => compileSimulationBlueprintRules({ ...rules(), schemaVersion: "simulation-blueprint-rules.v2" }),
    (error: unknown) => error instanceof SimulationBlueprintError && error.code === "rules_version_unsupported",
  );
  const incomplete = structuredClone(rules()) as unknown as Record<string, unknown>;
  const scoring = incomplete.scoring as Record<string, unknown>;
  delete scoring.aggregateFloor;
  assert.throws(
    () => compileSimulationBlueprintRules(incomplete),
    (error: unknown) => error instanceof SimulationBlueprintError && error.code === "scoring_has_unknown_or_missing_fields",
  );
  assert.throws(
    () => compileSimulationBlueprintRules({ ...rules(), editorialGuess: true }),
    (error: unknown) => error instanceof SimulationBlueprintError && error.code === "rules_have_unknown_or_missing_fields",
  );
});

test("rules reject ambiguous or unsupported incorrect and unanswered scoring", () => {
  const missingPenalty = structuredClone(rules());
  missingPenalty.subjects[0].incorrect = { policy: "penalty" } as never;
  assert.throws(() => compileSimulationBlueprintRules(missingPenalty), /subject_0_penalty_has_unknown_or_missing_fields/);

  const inventedUnansweredPenalty = structuredClone(rules());
  inventedUnansweredPenalty.subjects[0].unanswered = { policy: "penalty", points: "1" } as never;
  assert.throws(() => compileSimulationBlueprintRules(inventedUnansweredPenalty), /subject_0_unanswered_has_unknown_or_missing_fields/);

  const implicitWrongScore = structuredClone(rules()) as unknown as { subjects: Array<Record<string, unknown>> };
  delete implicitWrongScore.subjects[1].incorrect;
  assert.throws(() => compileSimulationBlueprintRules(implicitWrongScore), /subject_1_has_unknown_or_missing_fields/);
});

test("rules reject duplicate and inconsistent subject counts", () => {
  assert.throws(
    () => compileSimulationBlueprintRules({ ...rules(), subjects: [rules().subjects[0], rules().subjects[0], rules().subjects[1]] }),
    /duplicate_subject_id/,
  );
  assert.throws(
    () => compileSimulationBlueprintRules({ ...rules(), questionCount: 4 }),
    /subject_question_count_mismatch/,
  );
});

test("technical limits reject gigantic rules and question payloads before resource exhaustion", () => {
  assert.throws(
    () => compileSimulationBlueprintRules({
      ...rules(),
      questionCount: 10_001,
      subjects: [{ ...rules().subjects[0], questionCount: 10_001 }],
    }),
    /question_count_limit_exceeded/,
  );
  assert.throws(
    () => compileSimulationBlueprintRules({ ...rules(), durationMinutes: 10_081 }),
    /duration_minutes_limit_exceeded/,
  );
  assert.throws(
    () => compileSimulationBlueprintRules({
      ...rules(),
      subjects: Array.from({ length: 4 }, (_, index) => ({
        ...rules().subjects[0],
        subjectId: `subject-${index}`,
        questionCount: 1,
      })),
    }),
    /subject_count_exceeds_question_count/,
  );
  assert.throws(
    () => snapshot(rules(), [
      { ...questions()[0], optionIds: Array.from({ length: 101 }, (_, index) => `option-${index}`), correctOptionId: "option-0" },
      questions()[1],
      questions()[2],
    ]),
    /question_0_options_invalid/,
  );
  const tooLargeDecimal = structuredClone(rules());
  tooLargeDecimal.subjects[0].correctPoints = "1000000000000";
  assert.throws(() => compileSimulationBlueprintRules(tooLargeDecimal), /subject_0_correct_points_invalid/);
});

test("snapshot validates exact per-subject coverage and rejects duplicate questions/options", () => {
  const wrongCoverage = questions().map((question) => ({ ...question }));
  wrongCoverage[1].subjectId = "portugues";
  assert.throws(() => snapshot(rules(), wrongCoverage), /subject_portugues_snapshot_count_mismatch/);

  const duplicateQuestions = questions().map((question) => ({ ...question }));
  duplicateQuestions[1].questionVersionId = duplicateQuestions[0].questionVersionId;
  assert.throws(() => snapshot(rules(), duplicateQuestions), /duplicate_question_version_id/);

  const duplicateOptions = questions().map((question) => ({ ...question, optionIds: [...question.optionIds] }));
  duplicateOptions[0].optionIds = ["a", "a"];
  assert.throws(() => snapshot(rules(), duplicateOptions), /duplicate_option_id/);

  const sparseQuestions = new Array<SimulationQuestionInput>(3);
  sparseQuestions[0] = questions()[0];
  sparseQuestions[2] = questions()[2];
  assert.throws(() => snapshot(rules(), sparseQuestions), /snapshot_questions_must_be_dense_array/);

  const sparseOptions = questions().map((question) => ({ ...question, optionIds: [...question.optionIds] }));
  const optionIds = new Array<string>(2);
  optionIds[1] = "b";
  sparseOptions[0].optionIds = optionIds;
  sparseOptions[0].correctOptionId = "b";
  assert.throws(() => snapshot(rules(), sparseOptions), /question_0_options_invalid/);

  const decoratedQuestions = questions() as SimulationQuestionInput[] & { correctOptionId?: string };
  decoratedQuestions.correctOptionId = "b";
  assert.throws(() => snapshot(rules(), decoratedQuestions), /snapshot_questions_must_be_dense_array/);
});

test("snapshot makes order, rules and question versions immutable and hash-reproducible", () => {
  const sourceQuestions = questions();
  const first = snapshot(rules(), sourceQuestions);
  const second = snapshot(rules(), questions());
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.deepEqual(first.questions.map((question) => question.questionVersionId), ["q-port-1-v3", "q-mat-1-v2", "q-port-2-v1"]);
  const presentation = createSimulationPresentation(first);
  assert.equal(presentation[1].questionVersionId, "q-mat-1-v2");
  assert.equal("correctOptionId" in presentation[1], false);
  assert.equal(Object.isFrozen(presentation[1].optionIds), true);
  assert.equal(Object.isFrozen(first.questions[0].optionIds), true);

  sourceQuestions[0].questionVersionId = "mutated-after-snapshot";
  (sourceQuestions[0].optionIds as string[])[0] = "mutated-option";
  assert.equal(first.questions[0].questionVersionId, "q-port-1-v3");
  assert.equal(first.questions[0].optionIds[0], "a");

  const reordered = questions();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.notEqual(snapshot(rules(), reordered).snapshotHash, first.snapshotHash);
});

test("rehydrated snapshots are strictly revalidated and frozen before use", () => {
  const rehydrated = JSON.parse(JSON.stringify(snapshot())) as SimulationSnapshot;
  assert.equal(Object.isFrozen(rehydrated), false);
  createSimulationState(rehydrated);
  assert.equal(Object.isFrozen(rehydrated), true);
  assert.equal(Object.isFrozen(rehydrated.rules), true);
  assert.equal(Object.isFrozen(rehydrated.questions[0].optionIds), true);

  const withUnknownField = JSON.parse(JSON.stringify(snapshot())) as SimulationSnapshot & { auditBypass?: boolean };
  withUnknownField.auditBypass = true;
  assert.throws(() => createSimulationState(withUnknownField), /snapshot_has_unknown_or_missing_fields/);

  const forgedDeadline = JSON.parse(JSON.stringify(snapshot())) as SimulationSnapshot;
  (forgedDeadline as unknown as { deadlineAtMs: number }).deadlineAtMs += 60_000;
  rehashSnapshot(forgedDeadline);
  assert.throws(() => createSimulationState(forgedDeadline), /snapshot_deadline_inconsistent/);

  const forgedPosition = JSON.parse(JSON.stringify(snapshot())) as SimulationSnapshot;
  (forgedPosition.questions[1] as unknown as { position: number }).position = 0;
  rehashSnapshot(forgedPosition);
  assert.throws(() => createSimulationState(forgedPosition), /snapshot_question_position_inconsistent/);

  const nonCanonicalRule = JSON.parse(JSON.stringify(snapshot())) as SimulationSnapshot;
  (nonCanonicalRule.rules.subjects[0] as unknown as { correctPoints: string }).correctPoints = "1.000000";
  rehashSnapshot(nonCanonicalRule);
  assert.throws(() => createSimulationState(nonCanonicalRule), /snapshot_rules_not_canonical/);
});

test("presentation is a frozen allowlist and exposes neither answer key nor its hash verifier", () => {
  const presentation = createSimulationPresentation(snapshot());
  const serialized = JSON.stringify(presentation);
  assert.equal(serialized.includes("correctOptionId"), false);
  assert.equal(serialized.includes("snapshotHash"), false);
  assert.deepEqual(Object.keys(presentation[0]).sort(), ["optionIds", "position", "questionVersionId", "subjectId"]);
  assert.equal(Object.isFrozen(presentation), true);
  assert.equal(Object.isFrozen(presentation[0]), true);
});

test("absolute deadline is exclusive: one millisecond before is accepted and exact boundary finalizes", () => {
  const currentSnapshot = snapshot();
  const beforeDeadline = submitSimulationAnswer(currentSnapshot, createSimulationState(currentSnapshot), {
    idempotencyKey: "before",
    questionVersionId: "q-port-1-v3",
    selectedOptionId: "b",
    receivedAtMs: currentSnapshot.deadlineAtMs - 1,
  });
  assert.equal(beforeDeadline.outcome, "accepted");
  assert.equal(beforeDeadline.state.status, "active");

  const atDeadline = submitSimulationAnswer(currentSnapshot, beforeDeadline.state, {
    idempotencyKey: "boundary",
    questionVersionId: "q-mat-1-v2",
    selectedOptionId: "d",
    receivedAtMs: currentSnapshot.deadlineAtMs,
  });
  assert.equal(atDeadline.outcome, "finalized");
  assert.equal(atDeadline.state.finishReason, "deadline");
  assert.equal(atDeadline.state.finalizedAtMs, currentSnapshot.deadlineAtMs);
  assert.equal(atDeadline.state.answers.length, 1);
});

test("clock tick finalizes exactly at deadline and not before it", () => {
  const currentSnapshot = snapshot();
  const initial = createSimulationState(currentSnapshot);
  assert.equal(finishSimulationAtTime(currentSnapshot, initial, currentSnapshot.deadlineAtMs - 1), initial);
  const finished = finishSimulationAtTime(currentSnapshot, initial, currentSnapshot.deadlineAtMs + 50_000);
  assert.equal(finished.status, "finalized");
  assert.equal(finished.finalizedAtMs, currentSnapshot.deadlineAtMs);
  assert.equal(finished.finishReason, "deadline");
});

test("first answer wins, exact replays are idempotent, and key reuse cannot change payload", () => {
  const currentSnapshot = snapshot();
  const first = submitSimulationAnswer(currentSnapshot, createSimulationState(currentSnapshot), {
    idempotencyKey: "stable-key",
    questionVersionId: "q-port-1-v3",
    selectedOptionId: "b",
    receivedAtMs: START + 1_000,
  });
  const replay = submitSimulationAnswer(currentSnapshot, first.state, {
    idempotencyKey: "stable-key",
    questionVersionId: "q-port-1-v3",
    selectedOptionId: "b",
    receivedAtMs: START + 59_000,
  });
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.state, first.state);
  assert.equal(replay.state.answers[0].receivedAtMs, START + 1_000);

  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, first.state, {
      idempotencyKey: "stable-key",
      questionVersionId: "q-port-1-v3",
      selectedOptionId: "a",
      receivedAtMs: START + 2_000,
    }),
    /idempotency_key_conflict/,
  );
  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, first.state, {
      idempotencyKey: "different-key",
      questionVersionId: "q-port-1-v3",
      selectedOptionId: "b",
      receivedAtMs: START + 2_000,
    }),
    /question_already_answered/,
  );
});

test("answer commands and rehydrated states reject schema smuggling and remain immutable", () => {
  const currentSnapshot = snapshot();
  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, createSimulationState(currentSnapshot), {
      idempotencyKey: "schema-smuggling",
      questionVersionId: "q-port-1-v3",
      selectedOptionId: "b",
      receivedAtMs: START + 1_000,
      isCorrect: true,
    } as never),
    /answer_command_has_unknown_or_missing_fields/,
  );
  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, createSimulationState(currentSnapshot), {
      idempotencyKey: "bad\nlog",
      questionVersionId: "q-port-1-v3",
      selectedOptionId: "b",
      receivedAtMs: START + 1_000,
    }),
    /idempotency_key_invalid/,
  );

  const rehydratedState = JSON.parse(JSON.stringify(createSimulationState(currentSnapshot))) as SimulationState;
  const sameState = finishSimulationAtTime(currentSnapshot, rehydratedState, START + 1_000);
  assert.equal(sameState, rehydratedState);
  assert.equal(Object.isFrozen(rehydratedState), true);
  assert.equal(Object.isFrozen(rehydratedState.answers), true);

  const extraState = JSON.parse(JSON.stringify(createSimulationState(currentSnapshot))) as SimulationState & { score?: number };
  extraState.score = 999;
  assert.throws(() => finishSimulationAtTime(currentSnapshot, extraState, START + 1_000), /state_has_unknown_or_missing_fields/);

  const malformedState = JSON.parse(JSON.stringify(createSimulationState(currentSnapshot))) as unknown as { answers: unknown[] };
  malformedState.answers = [null];
  assert.throws(
    () => finishSimulationAtTime(currentSnapshot, malformedState as unknown as SimulationState, START + 1_000),
    (error: unknown) => error instanceof SimulationBlueprintError && error.code === "state_answer_0_must_be_object",
  );
});

test("server clock regression cannot reorder accepted answers or finalize inconsistently", () => {
  const currentSnapshot = snapshot();
  const first = submitSimulationAnswer(currentSnapshot, createSimulationState(currentSnapshot), {
    idempotencyKey: "clock-1",
    questionVersionId: "q-port-1-v3",
    selectedOptionId: "b",
    receivedAtMs: START + 2_000,
  });
  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, first.state, {
      idempotencyKey: "clock-2",
      questionVersionId: "q-mat-1-v2",
      selectedOptionId: "d",
      receivedAtMs: START + 1_999,
    }),
    /clock_regression/,
  );
  assert.throws(() => finishSimulationAtTime(currentSnapshot, first.state, START + 1_999), /clock_regression/);
});

test("answering the declared number of unique questions finalizes by quantity", () => {
  const currentSnapshot = snapshot();
  let state = createSimulationState(currentSnapshot);
  state = answer(currentSnapshot, state, "q-mat-1-v2", "d", 1).state;
  state = answer(currentSnapshot, state, "q-port-2-v1", "c", 2).state;
  const final = answer(currentSnapshot, state, "q-port-1-v3", "b", 3);
  assert.equal(final.state.status, "finalized");
  assert.equal(final.state.finishReason, "question-count");
  assert.equal(final.state.finalizedAtMs, START + 3_000);
  assert.equal(final.state.answers.length, currentSnapshot.rules.questionCount);
});

test("deadline arithmetic rejects overflow instead of wrapping", () => {
  assert.throws(
    () => snapshot(rules({ durationMinutes: 2 }), questions(), Number.MAX_SAFE_INTEGER - 60_000),
    /deadline_overflow/,
  );
  assert.throws(
    () => snapshot(rules(), questions(), -0),
    /started_at_invalid/,
  );
});

test("weighted scoring, explicit penalty and unanswered zero are deterministic", () => {
  const currentSnapshot = snapshot();
  let state = createSimulationState(currentSnapshot);
  state = answer(currentSnapshot, state, "q-port-1-v3", "b", 1).state; // +1 * 2 = +2
  state = answer(currentSnapshot, state, "q-port-2-v1", "d", 2).state; // -0.25 * 2 = -0.5
  state = finishSimulationAtTime(currentSnapshot, state, currentSnapshot.deadlineAtMs);
  const result = computeSimulationResult(currentSnapshot, state);
  assert.equal(result.score, "1.50");
  assert.equal(result.maxScore, "7.00");
  assert.deepEqual(
    { correct: result.correctCount, incorrect: result.incorrectCount, unanswered: result.unansweredCount },
    { correct: 1, incorrect: 1, unanswered: 1 },
  );
  assert.deepEqual(result.subjects, [
    { subjectId: "portugues", score: "1.50", maxScore: "4.00", correctCount: 1, incorrectCount: 1, unansweredCount: 0 },
    { subjectId: "matematica", score: "0.00", maxScore: "3.00", correctCount: 0, incorrectCount: 0, unansweredCount: 1 },
  ]);
});

test("half-away-from-zero rounding is symmetric at positive and negative ties", () => {
  const tieRules: SimulationBlueprintRulesV1 = {
    schemaVersion: SIMULATION_RULES_VERSION,
    questionCount: 2,
    durationMinutes: 1,
    scoring: {
      model: "weighted-sum.v1",
      rounding: { decimalPlaces: 2, mode: "half-away-from-zero" },
      aggregateFloor: { policy: "none" },
    },
    subjects: [
      {
        subjectId: "positive",
        questionCount: 1,
        correctPoints: "0.005",
        weight: "1",
        incorrect: { policy: "zero" },
        unanswered: { policy: "zero" },
      },
      {
        subjectId: "negative",
        questionCount: 1,
        correctPoints: "1",
        weight: "1",
        incorrect: { policy: "penalty", penaltyPoints: "0.005" },
        unanswered: { policy: "zero" },
      },
    ],
  };
  const tieQuestions: SimulationQuestionInput[] = [
    { questionVersionId: "positive-q", subjectId: "positive", optionIds: ["a", "b"], correctOptionId: "a" },
    { questionVersionId: "negative-q", subjectId: "negative", optionIds: ["a", "b"], correctOptionId: "a" },
  ];
  const currentSnapshot = snapshot(tieRules, tieQuestions);
  let state = createSimulationState(currentSnapshot);
  state = answer(currentSnapshot, state, "positive-q", "a", 1).state;
  state = answer(currentSnapshot, state, "negative-q", "b", 2).state;
  const result = computeSimulationResult(currentSnapshot, state);
  assert.equal(result.score, "0.00");
  assert.equal(result.subjects[0].score, "0.01");
  assert.equal(result.subjects[1].score, "-0.01");
});

test("maximum supported decimals are scored with BigInt without precision loss", () => {
  const largeRules: SimulationBlueprintRulesV1 = {
    schemaVersion: SIMULATION_RULES_VERSION,
    questionCount: 1,
    durationMinutes: 1,
    scoring: {
      model: "weighted-sum.v1",
      rounding: { decimalPlaces: 6, mode: "half-away-from-zero" },
      aggregateFloor: { policy: "none" },
    },
    subjects: [{
      subjectId: "large",
      questionCount: 1,
      correctPoints: "999999999999.999999",
      weight: "999999999999.999999",
      incorrect: { policy: "zero" },
      unanswered: { policy: "zero" },
    }],
  };
  const currentSnapshot = snapshot(largeRules, [
    { questionVersionId: "large-q", subjectId: "large", optionIds: ["a", "b"], correctOptionId: "a" },
  ]);
  const final = answer(currentSnapshot, createSimulationState(currentSnapshot), "large-q", "a", 1).state;
  const result = computeSimulationResult(currentSnapshot, final);
  assert.equal(result.score, "999999999999999998000000.000000");
  assert.equal(result.maxScore, "999999999999999998000000.000000");
});

test("aggregate zero floor is explicit and does not rewrite per-subject evidence", () => {
  const floorRules = structuredClone(rules());
  floorRules.scoring.aggregateFloor = { policy: "zero" };
  const currentSnapshot = snapshot(floorRules);
  let state = createSimulationState(currentSnapshot);
  state = answer(currentSnapshot, state, "q-port-1-v3", "a", 1).state;
  state = finishSimulationAtTime(currentSnapshot, state, currentSnapshot.deadlineAtMs);
  const result = computeSimulationResult(currentSnapshot, state);
  assert.equal(result.score, "0.00");
  assert.equal(result.subjects[0].score, "-0.50");
});

test("final result and hash reproduce exactly from the same immutable snapshot and state", () => {
  const currentSnapshot = snapshot();
  let state = createSimulationState(currentSnapshot);
  state = answer(currentSnapshot, state, "q-port-1-v3", "b", 1).state;
  state = finishSimulationAtTime(currentSnapshot, state, currentSnapshot.deadlineAtMs);
  const first = computeSimulationResult(currentSnapshot, state);
  const second = computeSimulationResult(currentSnapshot, state);
  assert.deepEqual(first, second);
  assert.equal(first.resultHash, second.resultHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.subjects), true);
  assert.throws(() => computeSimulationResult(currentSnapshot, createSimulationState(currentSnapshot)), /simulation_not_finalized/);
});

test("invalid option, question and corrupted state are rejected server-side", () => {
  const currentSnapshot = snapshot();
  const state = createSimulationState(currentSnapshot);
  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, state, {
      idempotencyKey: "external-option",
      questionVersionId: "q-port-1-v3",
      selectedOptionId: "correct-because-client-says-so",
      receivedAtMs: START + 1_000,
    }),
    /selected_option_not_in_question/,
  );
  assert.throws(
    () => submitSimulationAnswer(currentSnapshot, state, {
      idempotencyKey: "external-question",
      questionVersionId: "attacker-question",
      selectedOptionId: "a",
      receivedAtMs: START + 1_000,
    }),
    /question_not_in_snapshot/,
  );
  const corrupted = {
    ...state,
    answers: [
      { idempotencyKey: "one", questionVersionId: "q-port-1-v3", selectedOptionId: "b", receivedAtMs: START + 1_000 },
      { idempotencyKey: "two", questionVersionId: "q-port-1-v3", selectedOptionId: "a", receivedAtMs: START + 2_000 },
    ],
  } as SimulationState;
  assert.throws(() => finishSimulationAtTime(currentSnapshot, corrupted, START + 3_000), /state_duplicate_question_answer/);

  let completed = createSimulationState(currentSnapshot);
  completed = answer(currentSnapshot, completed, "q-port-1-v3", "b", 1).state;
  completed = answer(currentSnapshot, completed, "q-mat-1-v2", "d", 2).state;
  completed = answer(currentSnapshot, completed, "q-port-2-v1", "a", 3).state;
  const wrongCompletionTime = JSON.parse(JSON.stringify(completed)) as SimulationState;
  (wrongCompletionTime as unknown as { finalizedAtMs: number }).finalizedAtMs += 1;
  assert.throws(
    () => computeSimulationResult(currentSnapshot, wrongCompletionTime),
    /question_count_finalized_at_inconsistent/,
  );

  const wrongVersion = JSON.parse(JSON.stringify(createSimulationState(currentSnapshot))) as SimulationState;
  (wrongVersion as unknown as { schemaVersion: string }).schemaVersion = "simulation-state.v2";
  assert.throws(() => finishSimulationAtTime(currentSnapshot, wrongVersion, START + 3_000), /state_version_unsupported/);

  const answerWithSmuggledCorrectness = JSON.parse(JSON.stringify(completed)) as SimulationState;
  (answerWithSmuggledCorrectness.answers[0] as unknown as { isCorrect: boolean }).isCorrect = true;
  assert.throws(
    () => computeSimulationResult(currentSnapshot, answerWithSmuggledCorrectness),
    /state_answer_0_has_unknown_or_missing_fields/,
  );
});
