import { z } from "zod";
import {
  AGE_INTEGRITY_CANONICALIZATION_VERSION,
  AgeIntegrityClientContextSchema,
  Base64Url32BytesSchema,
  IntegrityPlatformSchema,
  LowercaseUuidSchema,
  NormalizedPlatformAgeSignalSchema,
  PlatformAgeBandSchema,
  PlatformAgeSignalStatusSchema,
  ageIntegrityPlatformClaimIssues,
} from "@workspace/age-integrity";

export const HealthCheckResponse = z.object({ status: z.literal("ok") }).strict();

export const ReadinessCheckResponse = z.object({
  status: z.enum(["ready", "not_ready"]),
}).strict();

export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export const AgeBandSchema = z.enum(["under_13", "13_15", "16_17", "18_plus"]);
export const EligibilityReasonSchema = z.enum([
  "eligible",
  "identity_policy_unavailable",
  "age_profile_required",
  "under_13_not_supported",
  "terms_acceptance_required",
  "guardian_verification_required",
  "social_permission_required",
  "notifications_permission_required",
  "platform_age_signal_required",
  "platform_age_signal_unavailable",
  "platform_age_signal_minor",
  "platform_age_signal_conflict",
  "platform_age_signal_unverified",
]);

const EligibilityDecisionSchema = z.object({
  eligible: z.boolean(),
  reason: EligibilityReasonSchema,
}).strict();

export const OnboardingStateResponseSchema = z.object({
  configurationReady: z.boolean(),
  policyVersion: z.string().nullable(),
  ageBand: AgeBandSchema.nullable(),
  requiredDocuments: z.object({
    termsVersion: z.string().nullable(),
    privacyNoticeVersion: z.string().nullable(),
  }).strict(),
  termsAccepted: z.boolean(),
  privacyNoticeAcknowledged: z.boolean(),
  guardian: z.object({
    required: z.boolean(),
    verified: z.boolean(),
    status: z.enum(["not_required", "missing", "verified", "revoked"]),
  }).strict(),
  platformAgeSignal: z.object({
    required: z.literal(true),
    platform: z.enum(["ios", "android"]).nullable(),
    source: z.enum(["apple_declared_age_range", "google_play_age_signals"]).nullable(),
    status: z.enum([
      "missing",
      "shared",
      "not_shared",
      "verification_required",
      "not_required",
      "unsupported",
      "error",
    ]),
    ageBand: AgeBandSchema.nullable(),
    trust: z.enum(["none", "device_reported_monitoring", "server_verified"]),
    pendingConflict: z.boolean(),
    observedAt: z.string().datetime().nullable(),
  }).strict(),
  learning: EligibilityDecisionSchema,
  social: EligibilityDecisionSchema,
  notifications: EligibilityDecisionSchema,
  onboardingComplete: z.boolean(),
}).strict();

export const SetAgeProfileRequestSchema = z.object({ ageBand: AgeBandSchema }).strict();

export const PlatformAgeSignalReportRequestSchema = z.object({
  platform: z.enum(["ios", "android"]),
  status: z.enum([
    "shared",
    "not_shared",
    "verification_required",
    "not_required",
    "unsupported",
    "error",
  ]),
  ageBand: AgeBandSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === "shared" && value.ageBand === null) {
    context.addIssue({ code: "custom", path: ["ageBand"], message: "A faixa é obrigatória quando o sinal foi compartilhado." });
  }
  if (value.status !== "shared" && value.ageBand !== null) {
    context.addIssue({ code: "custom", path: ["ageBand"], message: "A faixa não pode ser enviada sem compartilhamento da loja." });
  }
});

export const RegisterIntegrityDeviceBindingRequestSchema = z.object({
  installationNonce: Base64Url32BytesSchema,
  platform: IntegrityPlatformSchema,
}).strict();

export const IntegrityDeviceBindingResponseSchema = z.object({
  deviceBindingId: LowercaseUuidSchema,
  platform: IntegrityPlatformSchema,
  environment: z.enum(["development", "production"]),
  status: z.enum(["active", "revoked"]),
  registeredAt: z.string().datetime(),
}).strict();

export const CreateIntegrityChallengeRequestSchema = z.object({
  purpose: z.literal("platform_age_signal"),
  platform: IntegrityPlatformSchema,
  deviceBindingId: LowercaseUuidSchema,
  appleKeyId: Base64Url32BytesSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.platform === "ios" && value.appleKeyId === null) {
    context.addIssue({ code: "custom", path: ["appleKeyId"], message: "iOS exige o key ID Apple canônico." });
  }
  if (value.platform === "android" && value.appleKeyId !== null) {
    context.addIssue({ code: "custom", path: ["appleKeyId"], message: "Android exige appleKeyId=null." });
  }
});

export const IntegrityChallengeResponseSchema = z.object({
  challengeId: LowercaseUuidSchema,
  nonce: Base64Url32BytesSchema,
  principalBinding: Base64Url32BytesSchema,
  principalBindingKeyVersion: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  canonicalizationVersion: z.literal(AGE_INTEGRITY_CANONICALIZATION_VERSION),
  expiresAt: z.string().datetime(),
}).strict();

const AppleAssertionSchema = z.string().min(16).max(24_576).regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  "A assertion deve usar Base64 canônico.",
);
const GoogleIntegrityTokenSchema = z.string().min(16).max(60_000).regex(
  /^[A-Za-z0-9._~-]+$/,
  "O token deve ser ASCII opaco sem whitespace ou caracteres de controle.",
);
const IntegrityEnvelopeBase = {
  challengeId: LowercaseUuidSchema,
  challengeNonce: Base64Url32BytesSchema,
  deviceBindingId: LowercaseUuidSchema,
  canonicalizationVersion: z.literal(AGE_INTEGRITY_CANONICALIZATION_VERSION),
  clientContext: AgeIntegrityClientContextSchema,
};

const AppleVerifiedPlatformAgeSignalEnvelopeSchema = z.object({
    ...IntegrityEnvelopeBase,
    signal: z.object({
      platform: z.literal("ios"),
      status: PlatformAgeSignalStatusSchema,
      ageBand: PlatformAgeBandSchema.nullable(),
    }).strict().superRefine((value, context) => {
      const parsed = NormalizedPlatformAgeSignalSchema.safeParse(value);
      for (const issue of parsed.success ? [] : parsed.error.issues) context.addIssue(issue);
    }),
    proof: z.object({
      provider: z.literal("apple_app_attest"),
      keyId: Base64Url32BytesSchema,
      assertion: AppleAssertionSchema,
    }).strict(),
  }).strict().superRefine((value, context) => {
    for (const issue of ageIntegrityPlatformClaimIssues({
      platform: "ios",
      clientContext: value.clientContext,
      signal: value.signal,
      proofKeyId: value.proof.keyId,
    })) {
      context.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
    }
  });

const GoogleVerifiedPlatformAgeSignalEnvelopeSchema = z.object({
    ...IntegrityEnvelopeBase,
    signal: z.object({
      platform: z.literal("android"),
      status: PlatformAgeSignalStatusSchema,
      ageBand: PlatformAgeBandSchema.nullable(),
    }).strict().superRefine((value, context) => {
      const parsed = NormalizedPlatformAgeSignalSchema.safeParse(value);
      for (const issue of parsed.success ? [] : parsed.error.issues) context.addIssue(issue);
    }),
    proof: z.object({
      provider: z.literal("google_play_integrity_standard"),
      integrityToken: GoogleIntegrityTokenSchema,
    }).strict(),
  }).strict().superRefine((value, context) => {
    for (const issue of ageIntegrityPlatformClaimIssues({
      platform: "android",
      clientContext: value.clientContext,
      signal: value.signal,
      proofKeyId: null,
    })) {
      context.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
    }
  });

export const VerifiedPlatformAgeSignalEnvelopeSchema = z.union([
  AppleVerifiedPlatformAgeSignalEnvelopeSchema,
  GoogleVerifiedPlatformAgeSignalEnvelopeSchema,
]);

export const IntegrityVerificationStatusSchema = z.enum([
  "verifying",
  "verified",
  "rejected",
  "expired",
  "indeterminate",
]);

export const IntegrityVerificationResponseSchema = z.object({
  verificationId: LowercaseUuidSchema,
  status: IntegrityVerificationStatusSchema,
  statusUrl: z.string().regex(/^\/api\/v1\/integrity\/verifications\/[0-9a-f-]{36}$/),
  retryAfterSeconds: z.number().int().min(1).max(30).nullable(),
  decision: z.enum([
    "verification_unavailable",
    "proof_rejected",
    "challenge_expired",
    "verified",
  ]).nullable(),
}).strict();

export const IdentityPolicySnapshotSchema = z.object({
  policyVersion: z.string().min(1).max(80),
  termsVersion: z.string().min(1).max(80),
  privacyNoticeVersion: z.string().min(1).max(80),
}).strict();

export const RecordLegalAcknowledgementRequestSchema = z.object({
  kind: z.enum(["terms_acceptance", "privacy_notice_acknowledgement"]),
  acknowledged: z.literal(true),
}).extend(IdentityPolicySnapshotSchema.shape).strict();

export const RecordOptionalConsentRequestSchema = z.object({
  kind: z.enum(["social", "notifications", "marketing"]),
  granted: z.boolean(),
}).strict();

export const GuardianInvitationResponseSchema = z.object({
  invitationId: z.string().uuid(),
  token: z.string().min(40).max(128),
  expiresAt: z.string().datetime(),
}).strict();

export const AcceptGuardianInvitationRequestSchema = z.object({
  token: z.string().min(40).max(128),
  acknowledgements: z.object({
    responsibility: z.literal(true),
    termsAccepted: z.literal(true),
    privacyNoticeAcknowledged: z.literal(true),
  }).strict(),
  permissions: z.object({
    social: z.boolean(),
    notifications: z.boolean(),
  }).strict(),
}).extend(IdentityPolicySnapshotSchema.shape).strict();

export const GuardianLinkResponseSchema = z.object({
  linkId: z.string().uuid(),
  status: z.literal("verified"),
  verifiedAt: z.string().datetime(),
  permissions: z.object({ social: z.boolean(), notifications: z.boolean() }).strict(),
}).strict();

export const GuardianLinkSummarySchema = z.object({
  linkId: z.string().uuid(),
  role: z.enum(["student", "guardian"]),
  counterpartPseudonym: z.string().min(1).max(80),
  status: z.literal("verified"),
  verifiedAt: z.string().datetime(),
}).strict();

export const GuardianLinksResponseSchema = z.object({
  links: z.array(GuardianLinkSummarySchema),
}).strict();

export const GuardianRevocationResponseSchema = z.object({
  linkId: z.string().uuid(),
  status: z.literal("revoked"),
  revokedAt: z.string().datetime(),
}).strict();

export const PublicQuestionSchema = z.object({
  exposureId: z.string().uuid(),
  questionVersionId: z.string().uuid(),
  sequence: z.number().int().positive(),
  subject: z.object({ id: z.string(), name: z.string() }),
  topic: z.object({ id: z.string().uuid(), name: z.string() }),
  statement: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  options: z.array(z.object({
    id: z.string().uuid(),
    key: z.string(),
    body: z.string(),
  }).strict()).min(2),
}).strict();

export const CatalogActiveResponseSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    institution: z.string().nullable(),
    category: z.string(),
    defaultTrack: z.string().nullable(),
    examVersions: z.array(z.object({
      id: z.string().uuid(),
      code: z.string(),
      board: z.string().nullable(),
      role: z.string().nullable(),
      phase: z.string().nullable(),
      modality: z.string().nullable(),
    })),
  })),
});

export const CreateLearningSessionRequestSchema = z.object({
  productId: z.string().min(1).max(80),
  examVersionId: z.string().uuid().optional(),
  mode: z.enum(["diagnostic", "practice", "review"]).default("practice"),
});

export const LearningSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["active", "completed"]),
  algorithmVersion: z.string(),
  nextQuestion: PublicQuestionSchema.nullable(),
});

export const SubmitAttemptRequestSchema = z.object({
  exposureId: z.string().uuid(),
  selectedOptionId: z.string().uuid(),
  elapsedMs: z.number().int().min(250).max(7_200_000),
});

export const AttemptResponseSchema = z.object({
  attemptId: z.string().uuid(),
  isCorrect: z.boolean(),
  correctOptionId: z.string().uuid(),
  solution: z.string(),
  optionRationales: z.record(z.string().uuid(), z.string()),
  validForCalibration: z.boolean(),
  mastery: z.object({
    topicId: z.string().uuid(),
    probability: z.number().min(0).max(1),
    observations: z.number().int().nonnegative(),
  }),
  nextQuestion: PublicQuestionSchema.nullable(),
});

export const ProgressResponseSchema = z.object({
  totalAnswered: z.number().int().nonnegative(),
  totalCorrect: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  topics: z.array(z.object({
    topicId: z.string().uuid(),
    topicName: z.string(),
    subjectId: z.string(),
    probability: z.number().min(0).max(1),
    observations: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
  })),
});

export const EntitlementResponseSchema = z.object({
  entitlement: z.literal("pro"),
  active: z.boolean(),
  status: z.enum(["free", "active", "grace_period", "expired", "revoked"]),
  productSku: z.string().nullable(),
  store: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
});

export const BillingIdentityResponseSchema = z.object({
  appUserId: z.string().uuid(),
}).strict();

// Restore is always scoped by the authenticated principal. Accepting any
// customer identifier from the client would let stale/mobile-controlled state
// select the RevenueCat customer that the server reconciles.
export const RestoreBillingRequestSchema = z.object({}).strict();

export const AsyncRequestResponseSchema = z.object({
  requestId: z.string().uuid(),
  status: z.literal("pending"),
});

export const DataRequestStatusResponseSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["export", "deletion"]),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  phase: z.enum([
    "requested",
    "export_snapshot",
    "export_stored",
    "access_revoked",
    "external_accounts_erased",
    "internal_data_erased",
    "completed",
  ]),
  requestedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  export: z.object({
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    expiresAt: z.string().datetime(),
    available: z.boolean(),
    downloadPath: z.string().regex(/^\/api\/v1\/me\/data-requests\/[0-9a-f-]{36}\/export$/),
  }).nullable(),
  errorCode: z.string().max(120).nullable(),
});

export const ReportRequestSchema = z.object({
  targetType: z.enum(["question", "user", "duel"]),
  targetId: z.string().min(1).max(255),
  reason: z.enum(["incorrect", "outdated", "copyright", "abuse", "cheating", "other"]),
  details: z.string().trim().max(2_000).optional(),
});

export const ReportResponseSchema = z.object({
  reportId: z.string().uuid(),
  status: z.literal("open"),
});

const CanonicalDecimalSchema = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/);
const SimulationSubjectRuleSchema = z.object({
  subjectId: z.string().min(1).max(200),
  questionCount: z.number().int().positive().max(10_000),
  correctPoints: CanonicalDecimalSchema,
  weight: CanonicalDecimalSchema,
  incorrect: z.discriminatedUnion("policy", [
    z.object({ policy: z.literal("zero") }).strict(),
    z.object({ policy: z.literal("penalty"), penaltyPoints: CanonicalDecimalSchema }).strict(),
  ]),
  unanswered: z.object({ policy: z.literal("zero") }).strict(),
}).strict();

export const SimulationBlueprintRulesSchema = z.object({
  schemaVersion: z.literal("simulation-blueprint-rules.v1"),
  questionCount: z.number().int().positive().max(10_000),
  durationMinutes: z.number().int().positive().max(10_080),
  scoring: z.object({
    model: z.literal("weighted-sum.v1"),
    rounding: z.object({
      decimalPlaces: z.number().int().min(0).max(6),
      mode: z.literal("half-away-from-zero"),
    }).strict(),
    aggregateFloor: z.object({ policy: z.enum(["none", "zero"]) }).strict(),
  }).strict(),
  subjects: z.array(SimulationSubjectRuleSchema).min(1).max(10_000),
}).strict();

export const SimulationBlueprintsResponseSchema = z.object({
  blueprints: z.array(z.object({
    id: z.string().uuid(),
    productId: z.string(),
    examVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    rules: SimulationBlueprintRulesSchema,
  }).strict()),
}).strict();

export const CreateSimulationRequestSchema = z.object({
  blueprintVersionId: z.string().uuid(),
}).strict();

export const SubmitSimulationAnswerRequestSchema = z.object({
  questionVersionId: z.string().uuid(),
  selectedOptionId: z.string().uuid(),
}).strict();

export const SimulationPublicQuestionSchema = z.object({
  position: z.number().int().nonnegative(),
  questionVersionId: z.string().uuid(),
  subject: z.object({ id: z.string(), name: z.string() }).strict(),
  statement: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  options: z.array(z.object({
    id: z.string().uuid(),
    key: z.string(),
    body: z.string(),
  }).strict()).min(2).max(100),
}).strict();

export const SimulationSessionResponseSchema = z.object({
  simulationId: z.string().uuid(),
  status: z.enum(["active", "finalized"]),
  serverNow: z.string().datetime(),
  startedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  blueprint: z.object({
    id: z.string().uuid(),
    productId: z.string(),
    examVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    rules: SimulationBlueprintRulesSchema,
  }).strict(),
  answeredQuestionVersionIds: z.array(z.string().uuid()),
  answers: z.array(z.object({
    questionVersionId: z.string().uuid(),
    selectedOptionId: z.string().uuid(),
  }).strict()),
  questions: z.array(SimulationPublicQuestionSchema),
  resultAvailable: z.boolean(),
}).strict();

export const ActiveSimulationResponseSchema = z.object({
  simulation: SimulationSessionResponseSchema.nullable(),
}).strict();

export const SimulationAnswerResponseSchema = z.object({
  outcome: z.enum(["accepted", "replayed", "finalized"]),
  status: z.enum(["active", "finalized"]),
  serverNow: z.string().datetime(),
  answeredQuestionVersionIds: z.array(z.string().uuid()),
  resultAvailable: z.boolean(),
}).strict();

export const SimulationResultResponseSchema = z.object({
  simulationId: z.string().uuid(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  finalizedAt: z.string().datetime(),
  finishReason: z.enum(["question-count", "deadline"]),
  score: z.string(),
  maxScore: z.string(),
  correctCount: z.number().int().nonnegative(),
  incorrectCount: z.number().int().nonnegative(),
  unansweredCount: z.number().int().nonnegative(),
  subjects: z.array(z.object({
    subjectId: z.string(),
    subjectName: z.string(),
    score: z.string(),
    maxScore: z.string(),
    correctCount: z.number().int().nonnegative(),
    incorrectCount: z.number().int().nonnegative(),
    unansweredCount: z.number().int().nonnegative(),
  }).strict()),
  questions: z.array(z.object({
    position: z.number().int().nonnegative(),
    questionVersionId: z.string().uuid(),
    statement: z.string(),
    subject: z.object({ id: z.string(), name: z.string() }).strict(),
    selectedOptionId: z.string().uuid().nullable(),
    correctOptionId: z.string().uuid(),
    isCorrect: z.boolean().nullable(),
    solution: z.string(),
    options: z.array(z.object({
      id: z.string().uuid(),
      key: z.string(),
      body: z.string(),
      rationale: z.string(),
    }).strict()).min(2).max(100),
  }).strict()),
}).strict();

export const SocialSummaryResponseSchema = z.object({
  enabled: z.boolean(),
  profile: z.object({
    pseudonym: z.string(),
    avatarKey: z.string(),
    inviteCode: z.string(),
  }).nullable(),
  friendCount: z.number().int().nonnegative(),
  pendingInvites: z.number().int().nonnegative(),
  activeDuels: z.number().int().nonnegative(),
});

export const HomeResponseSchema = z.object({
  activeProductId: z.string().nullable(),
  dailyGoalMinutes: z.number().int().positive(),
  streak: z.number().int().nonnegative(),
  progress: ProgressResponseSchema,
  entitlement: EntitlementResponseSchema,
});

export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;
