export type SimulationQuestionReview = {
  id: string;
  stage: string;
  reviewerId: string;
  decision: string;
  contentHash: string;
  decidedAt: Date;
};

const REQUIRED_STAGES = ["blind_solver", "subject_specialist", "independent_auditor"] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

/** Accepts only the latest decision in each mandatory review lane. */
export function hasEligibleSimulationQuestionReviews(
  questionContentHash: string,
  questionAuthorId: string,
  reviews: readonly SimulationQuestionReview[],
): boolean {
  if (!SHA256.test(questionContentHash) || !questionAuthorId.trim()) return false;
  const latest = new Map<string, SimulationQuestionReview>();
  const ordered = [...reviews].sort((left, right) => {
    const time = right.decidedAt.getTime() - left.decidedAt.getTime();
    return time !== 0 ? time : right.id.localeCompare(left.id);
  });
  for (const review of ordered) {
    if (!latest.has(review.stage)) latest.set(review.stage, review);
  }
  const mandatory = REQUIRED_STAGES.map((stage) => latest.get(stage));
  if (mandatory.some((review) => !review)) return false;
  const approved = mandatory as SimulationQuestionReview[];
  if (approved.some((review) => (
    review.decision !== "approved"
    || review.contentHash !== questionContentHash
    || !review.reviewerId.trim()
    || Number.isNaN(review.decidedAt.getTime())
  ))) return false;
  const reviewerIds = new Set(approved.map((review) => review.reviewerId));
  return reviewerIds.size === REQUIRED_STAGES.length && !reviewerIds.has(questionAuthorId);
}
