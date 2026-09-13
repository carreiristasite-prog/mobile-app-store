import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEligibleSimulationQuestionReviews,
  type SimulationQuestionReview,
} from "./simulation-reviews.ts";

const HASH = "b".repeat(64);

function review(stage: string, reviewerId: string, overrides: Partial<SimulationQuestionReview> = {}): SimulationQuestionReview {
  return {
    id: `review-${stage}-${reviewerId}`,
    stage,
    reviewerId,
    decision: "approved",
    contentHash: HASH,
    decidedAt: new Date("2026-08-23T12:00:00.000Z"),
    ...overrides,
  };
}

function approved(): SimulationQuestionReview[] {
  return [
    review("blind_solver", "solver-1"),
    review("subject_specialist", "specialist-1"),
    review("independent_auditor", "auditor-1"),
  ];
}

test("requires all three independently reviewed gates for the current hash", () => {
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "author-1", approved()), true);
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "author-1", approved().slice(1)), false);
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "author-1", approved().map((item) => ({ ...item, reviewerId: "same-reviewer" }))), false);
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "author-1", approved().map((item, index) => index === 1 ? { ...item, contentHash: "c".repeat(64) } : item)), false);
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "auditor-1", approved()), false);
});

test("a later rejection invalidates an older approval", () => {
  const reviews = approved();
  reviews.push(review("independent_auditor", "auditor-2", {
    id: "review-later-rejection",
    decision: "rejected",
    decidedAt: new Date("2026-08-23T13:00:00.000Z"),
  }));
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "author-1", reviews), false);
});

test("unknown, invalid or stale review records never replace mandatory gates", () => {
  assert.equal(hasEligibleSimulationQuestionReviews("not-a-hash", "author-1", approved()), false);
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "", approved()), false);
  assert.equal(hasEligibleSimulationQuestionReviews(HASH, "author-1", [
    ...approved(),
    review("adjudicator", "adjudicator-1", { decidedAt: new Date("invalid") }),
  ]), true);
});
