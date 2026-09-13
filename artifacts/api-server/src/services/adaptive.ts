import { createHash } from "node:crypto";

export const ADAPTIVE_ALGORITHM_VERSION = "bayes-60-20-20-v1";

export type SelectionMode = "diagnostic" | "practice" | "review" | "simulation";
export type SelectionBucket = "weakness" | "review" | "coverage" | "simulation";

export type AdaptiveCandidate = {
  questionVersionId: string;
  topicId: string;
  mastery: number | null;
  dueForReview: boolean;
  exposureCount: number;
  sessionTopicCount?: number;
};

function hashUnit(value: string): number {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return Number.parseInt(hex, 16) / 0xffffffffffff;
}

export function chooseBucket(mode: SelectionMode, seed: string, sequence: number): SelectionBucket {
  if (mode === "diagnostic") return "coverage";
  if (mode === "review") return "review";
  if (mode === "simulation") return "simulation";
  const roll = hashUnit(`${seed}:bucket:${sequence}`);
  if (roll < 0.6) return "weakness";
  if (roll < 0.8) return "review";
  return "coverage";
}

export function selectCandidate(
  candidates: readonly AdaptiveCandidate[],
  mode: SelectionMode,
  seed: string,
  sequence: number,
): { candidate: AdaptiveCandidate; bucket: SelectionBucket } | null {
  if (candidates.length === 0) return null;
  const bucket = chooseBucket(mode, seed, sequence);
  const scored = candidates.map((candidate) => {
    const mastery = candidate.mastery ?? 0.35;
    const tieBreak = hashUnit(`${seed}:${sequence}:${candidate.questionVersionId}`);
    let priority: number;
    switch (bucket) {
      case "weakness":
        priority = (1 - mastery) * 10 - candidate.exposureCount * 0.5;
        break;
      case "review":
        priority = (candidate.dueForReview ? 20 : 0) + (1 - mastery) * 5 - candidate.exposureCount;
        break;
      case "simulation":
      case "coverage":
        priority = -(candidate.sessionTopicCount ?? 0) * 100 - candidate.exposureCount;
        break;
    }
    return { candidate, score: priority + tieBreak * 0.001 };
  });
  scored.sort((a, b) => b.score - a.score || a.candidate.questionVersionId.localeCompare(b.candidate.questionVersionId));
  return { candidate: scored[0].candidate, bucket };
}

export function isValidForCalibration(elapsedMs: number): boolean {
  return elapsedMs >= 1_000 && elapsedMs <= 1_800_000;
}

export function updateMastery(
  priorProbability: number | null,
  observations: number,
  isCorrect: boolean,
  validForCalibration: boolean,
): { probability: number; observations: number } {
  const prior = Math.min(0.95, Math.max(0.05, priorProbability ?? 0.35));
  if (!validForCalibration) return { probability: prior, observations };
  const strength = Math.min(20, Math.max(4, observations));
  const posterior = (prior * strength + (isCorrect ? 1 : 0)) / (strength + 1);
  return {
    probability: Math.round(Math.min(0.95, Math.max(0.05, posterior)) * 10_000) / 10_000,
    observations: observations + 1,
  };
}
