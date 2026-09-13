import { createHash } from "node:crypto";

export const SIMULATION_RULES_VERSION = "simulation-blueprint-rules.v1" as const;
export const SIMULATION_SNAPSHOT_VERSION = "simulation-snapshot.v1" as const;
export const SIMULATION_STATE_VERSION = "simulation-state.v1" as const;
export const SIMULATION_RESULT_VERSION = "simulation-result.v1" as const;

const DECIMAL_INPUT_PLACES = 6;
const SCORE_PRODUCT_PLACES = DECIMAL_INPUT_PLACES * 2;
const MAX_SIMULATION_QUESTIONS = 10_000;
const MAX_SIMULATION_DURATION_MINUTES = 10_080;
const MAX_OPTIONS_PER_QUESTION = 100;

export class SimulationBlueprintError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "SimulationBlueprintError";
  }
}

export type IncorrectScoringRule =
  | { policy: "zero" }
  | { policy: "penalty"; penaltyPoints: string };

export type SubjectSimulationRule = {
  subjectId: string;
  questionCount: number;
  correctPoints: string;
  weight: string;
  incorrect: IncorrectScoringRule;
  unanswered: { policy: "zero" };
};

export type SimulationBlueprintRulesV1 = {
  schemaVersion: typeof SIMULATION_RULES_VERSION;
  questionCount: number;
  durationMinutes: number;
  scoring: {
    model: "weighted-sum.v1";
    rounding: {
      decimalPlaces: number;
      mode: "half-away-from-zero";
    };
    aggregateFloor: { policy: "none" } | { policy: "zero" };
  };
  subjects: readonly SubjectSimulationRule[];
};

export type SimulationQuestionInput = {
  questionVersionId: string;
  subjectId: string;
  optionIds: readonly string[];
  correctOptionId: string;
};

export type SimulationQuestionPresentation = Readonly<{
  position: number;
  questionVersionId: string;
  subjectId: string;
  optionIds: readonly string[];
}>;

export type SimulationSnapshot = Readonly<{
  schemaVersion: typeof SIMULATION_SNAPSHOT_VERSION;
  snapshotHash: string;
  sessionId: string;
  blueprintVersionId: string;
  rules: SimulationBlueprintRulesV1;
  startedAtMs: number;
  deadlineAtMs: number;
  questions: readonly Readonly<SimulationQuestionInput & { position: number }>[];
}>;

export type SimulationAnswer = Readonly<{
  idempotencyKey: string;
  questionVersionId: string;
  selectedOptionId: string;
  receivedAtMs: number;
}>;

export type SimulationState = Readonly<{
  schemaVersion: typeof SIMULATION_STATE_VERSION;
  sessionId: string;
  snapshotHash: string;
  status: "active" | "finalized";
  answers: readonly SimulationAnswer[];
  finalizedAtMs: number | null;
  finishReason: "question-count" | "deadline" | null;
}>;

export type SubmitSimulationAnswerCommand = {
  idempotencyKey: string;
  questionVersionId: string;
  selectedOptionId: string;
  receivedAtMs: number;
};

export type SimulationResultSubject = Readonly<{
  subjectId: string;
  score: string;
  maxScore: string;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
}>;

export type SimulationResult = Readonly<{
  schemaVersion: typeof SIMULATION_RESULT_VERSION;
  resultHash: string;
  sessionId: string;
  snapshotHash: string;
  finalizedAtMs: number;
  finishReason: "question-count" | "deadline";
  score: string;
  maxScore: string;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  subjects: readonly SimulationResultSubject[];
}>;

type PlainRecord = Record<string, unknown>;

function fail(code: string): never {
  throw new SimulationBlueprintError(code);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, code: string): PlainRecord {
  if (!isPlainRecord(value)) fail(code);
  return value;
}

function exactKeys(value: PlainRecord, expected: readonly string[], code: string): void {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) fail(code);
  const actual = (ownKeys as string[]).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}

function exactDenseArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.propertyIsEnumerable.call(value, index)) fail(code);
  }
  return value;
}

function identifier(value: unknown, code: string): string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > 200
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail(code);
  return value;
}

function positiveSafeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(code);
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) fail(code);
  return value as number;
}

function canonicalDecimal(value: unknown, code: string, allowZero: boolean): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value)) fail(code);
  const [whole, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const normalized = trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole;
  if (!allowZero && normalized === "0") fail(code);
  return normalized;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value as Readonly<T>;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hashObject(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalValuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function parseSubjectRule(value: unknown, index: number): SubjectSimulationRule {
  const input = record(value, `subject_${index}_must_be_object`);
  exactKeys(
    input,
    ["subjectId", "questionCount", "correctPoints", "weight", "incorrect", "unanswered"],
    `subject_${index}_has_unknown_or_missing_fields`,
  );
  const incorrectInput = record(input.incorrect, `subject_${index}_incorrect_must_be_object`);
  const incorrectPolicy = incorrectInput.policy;
  let incorrect: IncorrectScoringRule;
  if (incorrectPolicy === "zero") {
    exactKeys(incorrectInput, ["policy"], `subject_${index}_incorrect_zero_has_extra_fields`);
    incorrect = { policy: "zero" };
  } else if (incorrectPolicy === "penalty") {
    exactKeys(incorrectInput, ["policy", "penaltyPoints"], `subject_${index}_penalty_has_unknown_or_missing_fields`);
    incorrect = {
      policy: "penalty",
      penaltyPoints: canonicalDecimal(inputValue(incorrectInput, "penaltyPoints"), `subject_${index}_penalty_invalid`, false),
    };
  } else {
    fail(`subject_${index}_incorrect_policy_unsupported`);
  }

  const unansweredInput = record(input.unanswered, `subject_${index}_unanswered_must_be_object`);
  exactKeys(unansweredInput, ["policy"], `subject_${index}_unanswered_has_unknown_or_missing_fields`);
  if (unansweredInput.policy !== "zero") fail(`subject_${index}_unanswered_policy_unsupported`);

  return {
    subjectId: identifier(input.subjectId, `subject_${index}_id_invalid`),
    questionCount: positiveSafeInteger(input.questionCount, `subject_${index}_question_count_invalid`),
    correctPoints: canonicalDecimal(input.correctPoints, `subject_${index}_correct_points_invalid`, false),
    weight: canonicalDecimal(input.weight, `subject_${index}_weight_invalid`, false),
    incorrect,
    unanswered: { policy: "zero" },
  };
}

function inputValue(input: PlainRecord, key: string): unknown {
  return input[key];
}

export function compileSimulationBlueprintRules(inputValue: unknown): SimulationBlueprintRulesV1 {
  const input = record(inputValue, "rules_must_be_object");
  exactKeys(input, ["schemaVersion", "questionCount", "durationMinutes", "scoring", "subjects"], "rules_have_unknown_or_missing_fields");
  if (input.schemaVersion !== SIMULATION_RULES_VERSION) fail("rules_version_unsupported");

  const questionCount = positiveSafeInteger(input.questionCount, "question_count_invalid");
  const durationMinutes = positiveSafeInteger(input.durationMinutes, "duration_minutes_invalid");
  if (questionCount > MAX_SIMULATION_QUESTIONS) fail("question_count_limit_exceeded");
  if (durationMinutes > MAX_SIMULATION_DURATION_MINUTES) fail("duration_minutes_limit_exceeded");
  const durationMs = durationMinutes * 60_000;
  if (!Number.isSafeInteger(durationMs)) fail("duration_milliseconds_overflow");

  const scoringInput = record(input.scoring, "scoring_must_be_object");
  exactKeys(scoringInput, ["model", "rounding", "aggregateFloor"], "scoring_has_unknown_or_missing_fields");
  if (scoringInput.model !== "weighted-sum.v1") fail("scoring_model_unsupported");
  const roundingInput = record(scoringInput.rounding, "rounding_must_be_object");
  exactKeys(roundingInput, ["decimalPlaces", "mode"], "rounding_has_unknown_or_missing_fields");
  if (!Number.isSafeInteger(roundingInput.decimalPlaces)
    || (roundingInput.decimalPlaces as number) < 0
    || (roundingInput.decimalPlaces as number) > DECIMAL_INPUT_PLACES) fail("rounding_decimal_places_invalid");
  if (roundingInput.mode !== "half-away-from-zero") fail("rounding_mode_unsupported");
  const floorInput = record(scoringInput.aggregateFloor, "score_floor_must_be_object");
  exactKeys(floorInput, ["policy"], "score_floor_has_unknown_or_missing_fields");
  if (floorInput.policy !== "none" && floorInput.policy !== "zero") fail("score_floor_policy_unsupported");

  const subjectInputs = exactDenseArray(input.subjects, "subjects_must_be_dense_array");
  if (subjectInputs.length === 0) fail("subjects_must_be_non_empty_array");
  if (subjectInputs.length > questionCount) fail("subject_count_exceeds_question_count");
  const subjects = subjectInputs.map(parseSubjectRule);
  const subjectIds = new Set<string>();
  let subjectQuestionCount = 0;
  for (const subject of subjects) {
    if (subjectIds.has(subject.subjectId)) fail("duplicate_subject_id");
    subjectIds.add(subject.subjectId);
    subjectQuestionCount += subject.questionCount;
    if (!Number.isSafeInteger(subjectQuestionCount)) fail("subject_question_count_overflow");
  }
  if (subjectQuestionCount !== questionCount) fail("subject_question_count_mismatch");

  return deepFreeze({
    schemaVersion: SIMULATION_RULES_VERSION,
    questionCount,
    durationMinutes,
    scoring: {
      model: "weighted-sum.v1",
      rounding: {
        decimalPlaces: roundingInput.decimalPlaces as number,
        mode: "half-away-from-zero",
      },
      aggregateFloor: { policy: floorInput.policy as "none" | "zero" },
    },
    subjects,
  }) as SimulationBlueprintRulesV1;
}

function normalizeQuestions(
  inputs: readonly SimulationQuestionInput[],
  rules: SimulationBlueprintRulesV1,
): readonly Readonly<SimulationQuestionInput & { position: number }>[] {
  const questionInputs = exactDenseArray(inputs, "snapshot_questions_must_be_dense_array");
  if (questionInputs.length !== rules.questionCount) fail("snapshot_question_count_mismatch");
  const knownSubjects = new Map(rules.subjects.map((subject) => [subject.subjectId, subject.questionCount]));
  const actualSubjectCounts = new Map<string, number>();
  const questionIds = new Set<string>();
  return questionInputs.map((input, position) => {
    if (!isPlainRecord(input)) fail(`question_${position}_must_be_object`);
    exactKeys(input, ["questionVersionId", "subjectId", "optionIds", "correctOptionId"], `question_${position}_has_unknown_or_missing_fields`);
    const questionVersionId = identifier(input.questionVersionId, `question_${position}_id_invalid`);
    const subjectId = identifier(input.subjectId, `question_${position}_subject_id_invalid`);
    if (questionIds.has(questionVersionId)) fail("duplicate_question_version_id");
    questionIds.add(questionVersionId);
    if (!knownSubjects.has(subjectId)) fail("question_subject_not_in_blueprint");
    actualSubjectCounts.set(subjectId, (actualSubjectCounts.get(subjectId) ?? 0) + 1);
    const optionInputs = exactDenseArray(input.optionIds, `question_${position}_options_invalid`);
    if (optionInputs.length < 2 || optionInputs.length > MAX_OPTIONS_PER_QUESTION) fail(`question_${position}_options_invalid`);
    const optionIds = optionInputs.map((optionId, optionIndex) => identifier(optionId, `question_${position}_option_${optionIndex}_invalid`));
    if (new Set(optionIds).size !== optionIds.length) fail(`question_${position}_duplicate_option_id`);
    const correctOptionId = identifier(input.correctOptionId, `question_${position}_correct_option_invalid`);
    if (!optionIds.includes(correctOptionId)) fail(`question_${position}_correct_option_not_in_question`);
    return deepFreeze({ questionVersionId, subjectId, optionIds, correctOptionId, position });
  }).map((question) => {
    const expected = knownSubjects.get(question.subjectId) as number;
    const actual = actualSubjectCounts.get(question.subjectId) as number;
    if (actual !== expected) fail(`subject_${question.subjectId}_snapshot_count_mismatch`);
    return question;
  });
}

export function createSimulationSnapshot(inputValue: unknown): SimulationSnapshot {
  const input = record(inputValue, "snapshot_input_must_be_object");
  exactKeys(
    input,
    ["sessionId", "blueprintVersionId", "rules", "startedAtMs", "questions"],
    "snapshot_input_has_unknown_or_missing_fields",
  );
  const sessionId = identifier(input.sessionId, "session_id_invalid");
  const blueprintVersionId = identifier(input.blueprintVersionId, "blueprint_version_id_invalid");
  const startedAtMs = nonNegativeSafeInteger(input.startedAtMs, "started_at_invalid");
  const rules = compileSimulationBlueprintRules(input.rules);
  const questions = normalizeQuestions(input.questions as SimulationQuestionInput[], rules);
  const durationMs = rules.durationMinutes * 60_000;
  const deadlineAtMs = startedAtMs + durationMs;
  if (!Number.isSafeInteger(deadlineAtMs)) fail("deadline_overflow");
  const snapshotContent = {
    schemaVersion: SIMULATION_SNAPSHOT_VERSION,
    sessionId,
    blueprintVersionId,
    rules,
    startedAtMs,
    deadlineAtMs,
    questions,
  };
  return deepFreeze({ ...snapshotContent, snapshotHash: hashObject(snapshotContent) }) as SimulationSnapshot;
}

export function createSimulationState(snapshot: SimulationSnapshot): SimulationState {
  assertSnapshotIntegrity(snapshot);
  return deepFreeze({
    schemaVersion: SIMULATION_STATE_VERSION,
    sessionId: snapshot.sessionId,
    snapshotHash: snapshot.snapshotHash,
    status: "active",
    answers: [],
    finalizedAtMs: null,
    finishReason: null,
  }) as SimulationState;
}

function assertSnapshotIntegrity(snapshot: SimulationSnapshot): void {
  const input = record(snapshot, "snapshot_must_be_object");
  exactKeys(
    input,
    ["schemaVersion", "snapshotHash", "sessionId", "blueprintVersionId", "rules", "startedAtMs", "deadlineAtMs", "questions"],
    "snapshot_has_unknown_or_missing_fields",
  );
  if (input.schemaVersion !== SIMULATION_SNAPSHOT_VERSION) fail("snapshot_version_unsupported");
  if (typeof input.snapshotHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.snapshotHash)) fail("snapshot_hash_invalid");
  const sessionId = identifier(input.sessionId, "snapshot_session_id_invalid");
  const blueprintVersionId = identifier(input.blueprintVersionId, "snapshot_blueprint_version_id_invalid");
  const rules = compileSimulationBlueprintRules(input.rules);
  if (!canonicalValuesMatch(input.rules, rules)) fail("snapshot_rules_not_canonical");
  const startedAtMs = nonNegativeSafeInteger(input.startedAtMs, "snapshot_started_at_invalid");
  const deadlineAtMs = nonNegativeSafeInteger(input.deadlineAtMs, "snapshot_deadline_at_invalid");
  const expectedDeadlineAtMs = startedAtMs + rules.durationMinutes * 60_000;
  if (!Number.isSafeInteger(expectedDeadlineAtMs) || deadlineAtMs !== expectedDeadlineAtMs) fail("snapshot_deadline_inconsistent");
  const persistedQuestions = exactDenseArray(input.questions, "snapshot_questions_must_be_dense_array");
  const questionInputs = persistedQuestions.map((value, index): SimulationQuestionInput => {
    const question = record(value, `snapshot_question_${index}_must_be_object`);
    exactKeys(
      question,
      ["questionVersionId", "subjectId", "optionIds", "correctOptionId", "position"],
      `snapshot_question_${index}_has_unknown_or_missing_fields`,
    );
    const position = nonNegativeSafeInteger(question.position, `snapshot_question_${index}_position_invalid`);
    if (position !== index) fail("snapshot_question_position_inconsistent");
    return {
      questionVersionId: question.questionVersionId as string,
      subjectId: question.subjectId as string,
      optionIds: question.optionIds as string[],
      correctOptionId: question.correctOptionId as string,
    };
  });
  const questions = normalizeQuestions(questionInputs, rules);
  if (!canonicalValuesMatch(input.questions, questions)) fail("snapshot_questions_not_canonical");
  const normalizedContent = {
    schemaVersion: SIMULATION_SNAPSHOT_VERSION,
    sessionId,
    blueprintVersionId,
    rules,
    startedAtMs,
    deadlineAtMs,
    questions,
  };
  if (hashObject(normalizedContent) !== input.snapshotHash) fail("snapshot_hash_mismatch");
  deepFreeze(snapshot);
}

function assertStateIntegrity(snapshot: SimulationSnapshot, state: SimulationState): void {
  assertSnapshotIntegrity(snapshot);
  const input = record(state, "state_must_be_object");
  exactKeys(
    input,
    ["schemaVersion", "sessionId", "snapshotHash", "status", "answers", "finalizedAtMs", "finishReason"],
    "state_has_unknown_or_missing_fields",
  );
  if (input.schemaVersion !== SIMULATION_STATE_VERSION) fail("state_version_unsupported");
  const sessionId = identifier(input.sessionId, "state_session_id_invalid");
  if (typeof input.snapshotHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.snapshotHash)) fail("state_snapshot_hash_invalid");
  if (sessionId !== snapshot.sessionId || input.snapshotHash !== snapshot.snapshotHash) fail("state_snapshot_mismatch");
  if (input.status !== "active" && input.status !== "finalized") fail("state_status_unsupported");
  const answerInputs = exactDenseArray(input.answers, "state_answers_must_be_dense_array");
  if (input.finalizedAtMs !== null) nonNegativeSafeInteger(input.finalizedAtMs, "state_finalized_at_invalid");
  if (input.finishReason !== null && input.finishReason !== "question-count" && input.finishReason !== "deadline") {
    fail("finish_reason_unsupported");
  }
  const questionById = new Map(snapshot.questions.map((question) => [question.questionVersionId, question]));
  const seenQuestions = new Set<string>();
  const seenKeys = new Set<string>();
  let lastReceivedAtMs = snapshot.startedAtMs;
  for (const [index, value] of answerInputs.entries()) {
    const answer = record(value, `state_answer_${index}_must_be_object`);
    exactKeys(
      answer,
      ["idempotencyKey", "questionVersionId", "selectedOptionId", "receivedAtMs"],
      `state_answer_${index}_has_unknown_or_missing_fields`,
    );
    const idempotencyKey = identifier(answer.idempotencyKey, `state_answer_${index}_idempotency_key_invalid`);
    const questionVersionId = identifier(answer.questionVersionId, `state_answer_${index}_question_id_invalid`);
    const selectedOptionId = identifier(answer.selectedOptionId, `state_answer_${index}_option_id_invalid`);
    const receivedAtMs = nonNegativeSafeInteger(answer.receivedAtMs, `state_answer_${index}_received_at_invalid`);
    if (seenQuestions.has(questionVersionId)) fail("state_duplicate_question_answer");
    if (seenKeys.has(idempotencyKey)) fail("state_duplicate_idempotency_key");
    seenQuestions.add(questionVersionId);
    seenKeys.add(idempotencyKey);
    const question = questionById.get(questionVersionId);
    if (!question || !question.optionIds.includes(selectedOptionId)) fail("state_answer_not_in_snapshot");
    if (receivedAtMs < snapshot.startedAtMs || receivedAtMs >= snapshot.deadlineAtMs) fail("state_answer_outside_time_window");
    if (receivedAtMs < lastReceivedAtMs) fail("state_answer_clock_regression");
    lastReceivedAtMs = receivedAtMs;
  }
  if (answerInputs.length > snapshot.rules.questionCount) fail("state_answer_count_overflow");
  if (input.status === "active") {
    if (input.finalizedAtMs !== null || input.finishReason !== null || answerInputs.length === snapshot.rules.questionCount) {
      fail("active_state_inconsistent");
    }
    deepFreeze(state);
    return;
  }
  if (input.finalizedAtMs === null || input.finishReason === null) fail("finalized_state_inconsistent");
  if (input.finishReason === "question-count") {
    if (answerInputs.length !== snapshot.rules.questionCount) fail("question_count_finalization_inconsistent");
    const lastAnswerAt = (answerInputs.at(-1) as SimulationAnswer | undefined)?.receivedAtMs;
    if (lastAnswerAt === undefined || input.finalizedAtMs !== lastAnswerAt) fail("question_count_finalized_at_inconsistent");
  } else if (input.finishReason === "deadline") {
    if (input.finalizedAtMs !== snapshot.deadlineAtMs || answerInputs.length >= snapshot.rules.questionCount) {
      fail("deadline_finalization_inconsistent");
    }
  }
  deepFreeze(state);
}

function finalizedState(
  snapshot: SimulationSnapshot,
  state: SimulationState,
  finalizedAtMs: number,
  finishReason: "question-count" | "deadline",
): SimulationState {
  return deepFreeze({
    ...state,
    status: "finalized",
    finalizedAtMs,
    finishReason,
    answers: [...state.answers],
  }) as SimulationState;
}

export function finishSimulationAtTime(snapshot: SimulationSnapshot, state: SimulationState, observedAtMs: number): SimulationState {
  assertStateIntegrity(snapshot, state);
  const now = nonNegativeSafeInteger(observedAtMs, "observed_at_invalid");
  if (now < snapshot.startedAtMs) fail("clock_before_simulation_start");
  const lastAnswerAtMs = state.answers.at(-1)?.receivedAtMs;
  if (lastAnswerAtMs !== undefined && now < lastAnswerAtMs) fail("clock_regression");
  if (state.status === "finalized" || now < snapshot.deadlineAtMs) return state;
  return finalizedState(snapshot, state, snapshot.deadlineAtMs, "deadline");
}

export function submitSimulationAnswer(
  snapshot: SimulationSnapshot,
  state: SimulationState,
  command: SubmitSimulationAnswerCommand,
): Readonly<{ state: SimulationState; outcome: "accepted" | "replayed" | "finalized" }> {
  assertStateIntegrity(snapshot, state);
  const input = record(command, "answer_command_must_be_object");
  exactKeys(
    input,
    ["idempotencyKey", "questionVersionId", "selectedOptionId", "receivedAtMs"],
    "answer_command_has_unknown_or_missing_fields",
  );
  const idempotencyKey = identifier(input.idempotencyKey, "idempotency_key_invalid");
  const questionVersionId = identifier(input.questionVersionId, "answer_question_id_invalid");
  const selectedOptionId = identifier(input.selectedOptionId, "selected_option_id_invalid");
  const receivedAtMs = nonNegativeSafeInteger(input.receivedAtMs, "received_at_invalid");

  const priorForKey = state.answers.find((answer) => answer.idempotencyKey === idempotencyKey);
  if (priorForKey) {
    if (priorForKey.questionVersionId !== questionVersionId || priorForKey.selectedOptionId !== selectedOptionId) {
      fail("idempotency_key_conflict");
    }
    return deepFreeze({ state, outcome: "replayed" });
  }

  const question = snapshot.questions.find((candidate) => candidate.questionVersionId === questionVersionId);
  if (!question) fail("question_not_in_snapshot");
  if (!question.optionIds.includes(selectedOptionId)) fail("selected_option_not_in_question");
  if (state.answers.some((answer) => answer.questionVersionId === questionVersionId)) fail("question_already_answered");
  if (receivedAtMs < snapshot.startedAtMs) fail("answer_before_simulation_start");
  const lastAnswerAtMs = state.answers.at(-1)?.receivedAtMs;
  if (lastAnswerAtMs !== undefined && receivedAtMs < lastAnswerAtMs) fail("clock_regression");
  if (state.status === "finalized") return deepFreeze({ state, outcome: "finalized" });
  if (receivedAtMs >= snapshot.deadlineAtMs) {
    return deepFreeze({
      state: finalizedState(snapshot, state, snapshot.deadlineAtMs, "deadline"),
      outcome: "finalized",
    });
  }

  const answer: SimulationAnswer = deepFreeze({ idempotencyKey, questionVersionId, selectedOptionId, receivedAtMs });
  const activeState = deepFreeze({ ...state, answers: [...state.answers, answer] }) as SimulationState;
  const nextState = activeState.answers.length === snapshot.rules.questionCount
    ? finalizedState(snapshot, activeState, receivedAtMs, "question-count")
    : activeState;
  return deepFreeze({ state: nextState, outcome: "accepted" });
}

function decimalUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(DECIMAL_INPUT_PLACES)
    + BigInt(fraction.padEnd(DECIMAL_INPUT_PLACES, "0"));
}

function subjectRawUnitScore(subject: SubjectSimulationRule, outcome: "correct" | "incorrect" | "unanswered"): bigint {
  if (outcome === "unanswered" || (outcome === "incorrect" && subject.incorrect.policy === "zero")) return 0n;
  const points = outcome === "correct"
    ? decimalUnits(subject.correctPoints)
    : -decimalUnits((subject.incorrect as Extract<IncorrectScoringRule, { policy: "penalty" }>).penaltyPoints);
  return points * decimalUnits(subject.weight);
}

function roundedDecimal(rawUnits: bigint, decimalPlaces: number): string {
  const divisor = 10n ** BigInt(SCORE_PRODUCT_PLACES - decimalPlaces);
  const negative = rawUnits < 0n;
  const absolute = negative ? -rawUnits : rawUnits;
  let rounded = absolute / divisor;
  const remainder = absolute % divisor;
  if (remainder * 2n >= divisor) rounded += 1n;
  if (negative) rounded = -rounded;
  const sign = rounded < 0n ? "-" : "";
  const digits = (rounded < 0n ? -rounded : rounded).toString().padStart(decimalPlaces + 1, "0");
  if (decimalPlaces === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
}

export function computeSimulationResult(snapshot: SimulationSnapshot, state: SimulationState): SimulationResult {
  assertStateIntegrity(snapshot, state);
  if (state.status !== "finalized" || state.finalizedAtMs === null || state.finishReason === null) fail("simulation_not_finalized");
  const answerByQuestion = new Map(state.answers.map((answer) => [answer.questionVersionId, answer]));
  const questionsBySubject = new Map<string, Array<(typeof snapshot.questions)[number]>>();
  for (const question of snapshot.questions) {
    const existing = questionsBySubject.get(question.subjectId);
    if (existing) existing.push(question);
    else questionsBySubject.set(question.subjectId, [question]);
  }
  const decimalPlaces = snapshot.rules.scoring.rounding.decimalPlaces;
  let totalRaw = 0n;
  let maximumRaw = 0n;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;

  const subjects = snapshot.rules.subjects.map((subjectRule) => {
    let raw = 0n;
    let maxRaw = 0n;
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    for (const question of questionsBySubject.get(subjectRule.subjectId) ?? []) {
      const answer = answerByQuestion.get(question.questionVersionId);
      const outcome = !answer ? "unanswered" : answer.selectedOptionId === question.correctOptionId ? "correct" : "incorrect";
      raw += subjectRawUnitScore(subjectRule, outcome);
      maxRaw += subjectRawUnitScore(subjectRule, "correct");
      if (outcome === "correct") correct += 1;
      else if (outcome === "incorrect") incorrect += 1;
      else unanswered += 1;
    }
    totalRaw += raw;
    maximumRaw += maxRaw;
    correctCount += correct;
    incorrectCount += incorrect;
    unansweredCount += unanswered;
    return {
      subjectId: subjectRule.subjectId,
      score: roundedDecimal(raw, decimalPlaces),
      maxScore: roundedDecimal(maxRaw, decimalPlaces),
      correctCount: correct,
      incorrectCount: incorrect,
      unansweredCount: unanswered,
    };
  });
  if (snapshot.rules.scoring.aggregateFloor.policy === "zero" && totalRaw < 0n) totalRaw = 0n;
  const resultContent = {
    schemaVersion: SIMULATION_RESULT_VERSION,
    sessionId: snapshot.sessionId,
    snapshotHash: snapshot.snapshotHash,
    finalizedAtMs: state.finalizedAtMs,
    finishReason: state.finishReason,
    score: roundedDecimal(totalRaw, decimalPlaces),
    maxScore: roundedDecimal(maximumRaw, decimalPlaces),
    correctCount,
    incorrectCount,
    unansweredCount,
    subjects,
  };
  return deepFreeze({ ...resultContent, resultHash: hashObject(resultContent) }) as SimulationResult;
}

export function createSimulationPresentation(snapshot: SimulationSnapshot): readonly SimulationQuestionPresentation[] {
  assertSnapshotIntegrity(snapshot);
  return deepFreeze(snapshot.questions.map((question) => ({
    position: question.position,
    questionVersionId: question.questionVersionId,
    subjectId: question.subjectId,
    optionIds: [...question.optionIds],
  })));
}

export function getSubjectRule(snapshot: SimulationSnapshot, subjectId: string): SubjectSimulationRule {
  assertSnapshotIntegrity(snapshot);
  const rule = snapshot.rules.subjects.find((candidate) => candidate.subjectId === subjectId);
  if (!rule) fail("subject_not_in_snapshot");
  return rule;
}
