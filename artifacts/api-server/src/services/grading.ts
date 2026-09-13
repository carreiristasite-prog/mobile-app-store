export class GradingInvariantError extends Error {}

export type GradeableOption = {
  id: string;
  isCorrect: boolean;
  rationale: string;
};

export type AttemptRequestIdentity = {
  sessionId: string;
  exposureId: string;
  selectedOptionId: string;
  elapsedMs: number;
};

export function isSameAttemptRequest(left: AttemptRequestIdentity, right: AttemptRequestIdentity): boolean {
  return left.sessionId === right.sessionId
    && left.exposureId === right.exposureId
    && left.selectedOptionId === right.selectedOptionId
    && left.elapsedMs === right.elapsedMs;
}

export function gradeQuestion(options: readonly GradeableOption[], selectedOptionId: string) {
  const selected = options.find((option) => option.id === selectedOptionId);
  if (!selected) throw new GradingInvariantError("selected_option_not_in_question");
  const correct = options.filter((option) => option.isCorrect);
  if (correct.length !== 1) throw new GradingInvariantError("question_must_have_exactly_one_correct_option");
  return {
    isCorrect: selected.id === correct[0].id,
    correctOptionId: correct[0].id,
    rationales: Object.fromEntries(options.map((option) => [option.id, option.rationale])),
  };
}
