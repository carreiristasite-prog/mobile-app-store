import assert from "node:assert/strict";
import test from "node:test";
import { chooseBucket, isValidForCalibration, selectCandidate, updateMastery } from "./adaptive.ts";

test("the 60/20/20 bucket decision is deterministic for the same session", () => {
  const first = Array.from({ length: 100 }, (_, index) => chooseBucket("practice", "fixed-seed", index + 1));
  const second = Array.from({ length: 100 }, (_, index) => chooseBucket("practice", "fixed-seed", index + 1));
  assert.deepEqual(first, second);
  assert(first.includes("weakness"));
  assert(first.includes("review"));
  assert(first.includes("coverage"));
});

test("weakness selection prioritizes lower mastery and avoids exposure", () => {
  let selected = null;
  for (let sequence = 1; sequence < 1_000; sequence += 1) {
    if (chooseBucket("practice", "seed", sequence) === "weakness") {
      selected = selectCandidate([
        { questionVersionId: "a", topicId: "topic-a", mastery: 0.9, dueForReview: false, exposureCount: 0 },
        { questionVersionId: "b", topicId: "topic-b", mastery: 0.1, dueForReview: false, exposureCount: 0 },
      ], "practice", "seed", sequence);
      break;
    }
  }
  assert.equal(selected?.candidate.questionVersionId, "b");
});

test("mastery only changes for a valid first response", () => {
  assert.deepEqual(updateMastery(0.4, 8, true, false), { probability: 0.4, observations: 8 });
  const correct = updateMastery(0.4, 8, true, true);
  const incorrect = updateMastery(0.4, 8, false, true);
  assert(correct.probability > 0.4);
  assert(incorrect.probability < 0.4);
  assert.equal(correct.observations, 9);
});

test("diagnostic coverage prefers a topic not yet seen in the session", () => {
  const selected = selectCandidate([
    { questionVersionId: "seen-topic", topicId: "topic-a", mastery: null, dueForReview: false, exposureCount: 0, sessionTopicCount: 2 },
    { questionVersionId: "new-topic", topicId: "topic-b", mastery: null, dueForReview: false, exposureCount: 5, sessionTopicCount: 0 },
  ], "diagnostic", "diagnostic-seed", 3);
  assert.equal(selected?.candidate.questionVersionId, "new-topic");
});

test("implausible answer times are excluded from calibration", () => {
  assert.equal(isValidForCalibration(999), false);
  assert.equal(isValidForCalibration(1_000), true);
  assert.equal(isValidForCalibration(1_800_000), true);
  assert.equal(isValidForCalibration(1_800_001), false);
});
