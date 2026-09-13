import assert from "node:assert/strict";
import test from "node:test";
import { gradeQuestion, GradingInvariantError, isSameAttemptRequest } from "./grading.ts";

const options = [
  { id: "a", isCorrect: false, rationale: "distrator" },
  { id: "b", isCorrect: true, rationale: "gabarito" },
];

test("grading derives correctness exclusively from server-owned options", () => {
  assert.deepEqual(gradeQuestion(options, "a"), {
    isCorrect: false,
    correctOptionId: "b",
    rationales: { a: "distrator", b: "gabarito" },
  });
});

test("grading rejects an option that does not belong to the question", () => {
  assert.throws(() => gradeQuestion(options, "external"), GradingInvariantError);
});

test("grading rejects editorial data without exactly one answer", () => {
  assert.throws(() => gradeQuestion(options.map((option) => ({ ...option, isCorrect: false })), "a"), GradingInvariantError);
});

test("idempotent replay rejects reuse of a key with a different payload", () => {
  const original = { sessionId: "s1", exposureId: "e1", selectedOptionId: "o1", elapsedMs: 1_500 };
  assert.equal(isSameAttemptRequest(original, { ...original }), true);
  assert.equal(isSameAttemptRequest(original, { ...original, exposureId: "attacker-exposure" }), false);
  assert.equal(isSameAttemptRequest(original, { ...original, selectedOptionId: "attacker-option" }), false);
  assert.equal(isSameAttemptRequest(original, { ...original, elapsedMs: 1_501 }), false);
});
