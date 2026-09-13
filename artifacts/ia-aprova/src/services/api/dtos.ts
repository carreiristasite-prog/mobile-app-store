export type PublicQuestionDto = {
  exposureId: string;
  questionVersionId: string;
  sequence: number;
  subject: { id: string; name: string };
  topic: { id: string; name: string };
  statement: string;
  difficulty: 'easy' | 'medium' | 'hard';
  options: { id: string; key: string; body: string }[];
};

export type ProgressDto = {
  totalAnswered: number;
  totalCorrect: number;
  /** Decimal value from 0 to 1. */
  accuracy: number;
  topics: {
    topicId: string;
    topicName: string;
    subjectId: string;
    probability: number;
    observations: number;
    updatedAt: string;
  }[];
};

export type EntitlementDto = {
  entitlement: 'pro';
  active: boolean;
  status: 'free' | 'active' | 'grace_period' | 'expired' | 'revoked';
  productSku: string | null;
  store: string | null;
  expiresAt: string | null;
};

export type BillingIdentityDto = { appUserId: string };

export type HomeDto = {
  activeProductId: string | null;
  dailyGoalMinutes: number;
  streak: number;
  progress: ProgressDto;
  entitlement: EntitlementDto;
};

export type ActiveCatalogDto = {
  products: {
    id: string;
    slug: string;
    name: string;
    institution: string | null;
    category: string;
    defaultTrack: string | null;
    examVersions: {
      id: string;
      code: string;
      board: string | null;
      role: string | null;
      phase: string | null;
      modality: string | null;
    }[];
  }[];
};

export type LearningSessionDto = {
  sessionId: string;
  status: 'active' | 'completed';
  algorithmVersion: string;
  nextQuestion: PublicQuestionDto | null;
};

export type SessionQuestionDto = { question: PublicQuestionDto | null };

export type AttemptResultDto = {
  attemptId: string;
  isCorrect: boolean;
  correctOptionId: string;
  solution: string;
  optionRationales: Record<string, string>;
  validForCalibration: boolean;
  mastery: { topicId: string; probability: number; observations: number };
  nextQuestion: PublicQuestionDto | null;
};

export type SimulationBlueprintRulesDto = {
  schemaVersion: 'simulation-blueprint-rules.v1';
  questionCount: number;
  durationMinutes: number;
  scoring: {
    model: 'weighted-sum.v1';
    rounding: { decimalPlaces: number; mode: 'half-away-from-zero' };
    aggregateFloor: { policy: 'none' | 'zero' };
  };
  subjects: {
    subjectId: string;
    questionCount: number;
    correctPoints: string;
    weight: string;
    incorrect: { policy: 'zero' } | { policy: 'penalty'; penaltyPoints: string };
    unanswered: { policy: 'zero' };
  }[];
};

export type SimulationBlueprintDto = {
  id: string;
  productId: string;
  examVersionId: string;
  version: number;
  rules: SimulationBlueprintRulesDto;
};

export type SimulationQuestionDto = {
  position: number;
  questionVersionId: string;
  subject: { id: string; name: string };
  statement: string;
  difficulty: 'easy' | 'medium' | 'hard';
  options: { id: string; key: string; body: string }[];
};

export type SimulationSessionDto = {
  simulationId: string;
  status: 'active' | 'finalized';
  serverNow: string;
  startedAt: string;
  deadlineAt: string;
  blueprint: SimulationBlueprintDto;
  answeredQuestionVersionIds: string[];
  answers: { questionVersionId: string; selectedOptionId: string }[];
  questions: SimulationQuestionDto[];
  resultAvailable: boolean;
};

export type SimulationAnswerDto = {
  outcome: 'accepted' | 'replayed' | 'finalized';
  status: 'active' | 'finalized';
  serverNow: string;
  answeredQuestionVersionIds: string[];
  resultAvailable: boolean;
};

export type SimulationResultDto = {
  simulationId: string;
  resultHash: string;
  finalizedAt: string;
  finishReason: 'question-count' | 'deadline';
  score: string;
  maxScore: string;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  subjects: {
    subjectId: string;
    subjectName: string;
    score: string;
    maxScore: string;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
  }[];
  questions: {
    position: number;
    questionVersionId: string;
    statement: string;
    subject: { id: string; name: string };
    selectedOptionId: string | null;
    correctOptionId: string;
    isCorrect: boolean | null;
    solution: string;
    options: { id: string; key: string; body: string; rationale: string }[];
  }[];
};

export type SocialSummaryDto = {
  enabled: boolean;
  profile: { pseudonym: string; avatarKey: string; inviteCode: string } | null;
  friendCount: number;
  pendingInvites: number;
  activeDuels: number;
};

export type AgeBand = 'under_13' | '13_15' | '16_17' | '18_plus';

export type EligibilityReason =
  | 'eligible'
  | 'identity_policy_unavailable'
  | 'age_profile_required'
  | 'under_13_not_supported'
  | 'terms_acceptance_required'
  | 'guardian_verification_required'
  | 'social_permission_required'
  | 'notifications_permission_required'
  | 'platform_age_signal_required'
  | 'platform_age_signal_unavailable'
  | 'platform_age_signal_minor'
  | 'platform_age_signal_conflict'
  | 'platform_age_signal_unverified';

export type OnboardingStateDto = {
  configurationReady: boolean;
  policyVersion: string | null;
  ageBand: AgeBand | null;
  requiredDocuments: {
    termsVersion: string | null;
    privacyNoticeVersion: string | null;
  };
  termsAccepted: boolean;
  privacyNoticeAcknowledged: boolean;
  guardian: {
    required: boolean;
    verified: boolean;
    status: 'not_required' | 'missing' | 'verified' | 'revoked';
  };
  platformAgeSignal: {
    required: true;
    platform: 'ios' | 'android' | null;
    source: 'apple_declared_age_range' | 'google_play_age_signals' | null;
    status: PlatformAgeSignalStatus | 'missing';
    ageBand: AgeBand | null;
    trust: 'none' | 'device_reported_monitoring' | 'server_verified';
    observedAt: string | null;
  };
  learning: { eligible: boolean; reason: EligibilityReason };
  social: { eligible: boolean; reason: EligibilityReason };
  notifications: { eligible: boolean; reason: EligibilityReason };
  onboardingComplete: boolean;
};

export type PlatformAgeSignalStatus =
  | 'shared'
  | 'not_shared'
  | 'verification_required'
  | 'not_required'
  | 'unsupported'
  | 'error';

export type PlatformAgeSignalReport = {
  platform: 'ios' | 'android';
  status: PlatformAgeSignalStatus;
  ageBand: AgeBand | null;
};

export type GuardianInvitationDto = {
  invitationId: string;
  /** Sensitive, one-use secret. Keep only in memory and never log it. */
  token: string;
  expiresAt: string;
};

export type GuardianLinkDto = {
  linkId: string;
  status: 'verified';
  verifiedAt: string;
  permissions: { social: boolean; notifications: boolean };
};

export type GuardianLinkSummaryDto = {
  linkId: string;
  role: 'student' | 'guardian';
  counterpartPseudonym: string;
  status: 'verified';
  verifiedAt: string;
};

export type GuardianLinksDto = { links: GuardianLinkSummaryDto[] };

export type GuardianRevocationDto = {
  linkId: string;
  status: 'revoked';
  revokedAt: string;
};
