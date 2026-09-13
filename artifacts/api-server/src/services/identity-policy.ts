export const AGE_BANDS = ["under_13", "13_15", "16_17", "18_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGREEMENT_KINDS = [
  "terms_acceptance",
  "privacy_notice_acknowledgement",
  "guardian_responsibility_acknowledgement",
  "social",
  "notifications",
  "marketing",
] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export type IdentityPolicy = {
  policyVersion: string;
  termsVersion: string;
  privacyNoticeVersion: string;
  guardianInviteTtlSeconds: number;
};

export type IdentityPolicySnapshot = Pick<
  IdentityPolicy,
  "policyVersion" | "termsVersion" | "privacyNoticeVersion"
>;

export function identityPolicySnapshotMatches(
  snapshot: IdentityPolicySnapshot,
  current: IdentityPolicy,
): boolean {
  return snapshot.policyVersion === current.policyVersion
    && snapshot.termsVersion === current.termsVersion
    && snapshot.privacyNoticeVersion === current.privacyNoticeVersion;
}

export type AgreementRecord = {
  id: string;
  kind: AgreementKind;
  documentVersion: string;
  granted: boolean;
  actorRole: "self" | "guardian" | "system";
  recordedAt: Date;
};

export type EligibilityReason =
  | "eligible"
  | "identity_policy_unavailable"
  | "age_profile_required"
  | "under_13_not_supported"
  | "terms_acceptance_required"
  | "guardian_verification_required"
  | "social_permission_required"
  | "notifications_permission_required"
  | "platform_age_signal_required"
  | "platform_age_signal_unavailable"
  | "platform_age_signal_minor"
  | "platform_age_signal_conflict"
  | "platform_age_signal_unverified";

export type EligibilityDecision = {
  eligible: boolean;
  reason: EligibilityReason;
};

export type OnboardingEvaluation = {
  learning: EligibilityDecision;
  social: EligibilityDecision;
  notifications: EligibilityDecision;
  termsAccepted: boolean;
  privacyNoticeAcknowledged: boolean;
  guardianVerified: boolean;
  onboardingComplete: boolean;
};

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value || value.length > 80 || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Missing or invalid ${key}`);
  }
  return value;
}

export function loadIdentityPolicy(env: NodeJS.ProcessEnv = process.env): IdentityPolicy {
  const ttl = Number(env.GUARDIAN_INVITE_TTL_SECONDS ?? "604800");
  if (!Number.isSafeInteger(ttl) || ttl < 900 || ttl > 2_592_000) {
    throw new Error("GUARDIAN_INVITE_TTL_SECONDS must be an integer between 900 and 2592000");
  }
  return {
    policyVersion: requiredEnv(env, "IDENTITY_POLICY_VERSION"),
    termsVersion: requiredEnv(env, "REQUIRED_TERMS_VERSION"),
    privacyNoticeVersion: requiredEnv(env, "REQUIRED_PRIVACY_NOTICE_VERSION"),
    guardianInviteTtlSeconds: ttl,
  };
}

export function tryLoadIdentityPolicy(env: NodeJS.ProcessEnv = process.env): IdentityPolicy | null {
  try {
    return loadIdentityPolicy(env);
  } catch {
    return null;
  }
}

function latestAgreement(records: readonly AgreementRecord[], kind: AgreementKind): AgreementRecord | undefined {
  return records
    .filter((record) => record.kind === kind)
    .reduce<AgreementRecord | undefined>((latest, record) => {
      if (!latest) return record;
      const timeDifference = record.recordedAt.getTime() - latest.recordedAt.getTime();
      return timeDifference > 0 || (timeDifference === 0 && record.id > latest.id) ? record : latest;
    }, undefined);
}

function denied(reason: EligibilityReason): EligibilityDecision {
  return { eligible: false, reason };
}

const ELIGIBLE: EligibilityDecision = { eligible: true, reason: "eligible" };

export type PlatformAgeSignalEvidence = {
  status: "shared" | "not_shared" | "verification_required" | "not_required" | "unsupported" | "error";
  ageBand: AgeBand | null;
  trust: "device_reported_monitoring" | "server_verified";
  pendingConflict?: boolean;
};

/**
 * Store signals are a separate assurance input; they never replace the
 * self-declared age profile. A public client report can restrict access, but
 * only a later server-verified integration may satisfy the required gate.
 */
export function evaluatePlatformAgeSignal(input: {
  selfDeclaredAgeBand: AgeBand | null;
  signal: PlatformAgeSignalEvidence | null;
  required: boolean;
}): EligibilityDecision {
  const { selfDeclaredAgeBand, signal, required } = input;
  if (!signal) return required ? denied("platform_age_signal_required") : ELIGIBLE;
  if (signal.pendingConflict) return denied("platform_age_signal_conflict");
  if (signal.status === "verification_required" || signal.status === "not_shared") {
    return denied("platform_age_signal_required");
  }
  if (signal.status === "unsupported" || signal.status === "error") {
    return required ? denied("platform_age_signal_unavailable") : ELIGIBLE;
  }
  if (signal.status === "not_required") {
    return signal.trust === "server_verified" || !required
      ? ELIGIBLE
      : denied("platform_age_signal_unverified");
  }
  if (signal.ageBand === "under_13" || signal.ageBand === "13_15" || signal.ageBand === "16_17") {
    return denied("platform_age_signal_minor");
  }
  if (selfDeclaredAgeBand && signal.ageBand !== selfDeclaredAgeBand) {
    return denied("platform_age_signal_conflict");
  }
  if (signal.trust !== "server_verified") return denied("platform_age_signal_unverified");
  return ELIGIBLE;
}

/**
 * A client-reported store signal is not strong enough to prove adulthood, but
 * a shared contradictory band is strong enough to stop an unsafe adult flow.
 * Missing, declined, unsupported and merely unverified adult signals do not
 * block learning; they continue to block optional capabilities separately.
 */
export function evaluatePlatformAgeConsistency(input: {
  selfDeclaredAgeBand: AgeBand | null;
  signal: PlatformAgeSignalEvidence | null;
}): EligibilityDecision {
  const { selfDeclaredAgeBand, signal } = input;
  if (signal?.pendingConflict) return denied("platform_age_signal_conflict");
  if (!selfDeclaredAgeBand || signal?.status !== "shared" || !signal.ageBand) return ELIGIBLE;
  return signal.ageBand === selfDeclaredAgeBand
    ? ELIGIBLE
    : denied("platform_age_signal_conflict");
}

export function evaluateOnboarding(input: {
  policy: IdentityPolicy | null;
  ageBand: AgeBand | null;
  guardianVerified: boolean;
  socialEnabled: boolean;
  notificationsEnabled: boolean;
  agreements: readonly AgreementRecord[];
  platformAgeSignal: PlatformAgeSignalEvidence | null;
  platformAgeSignalRequired: boolean;
}): OnboardingEvaluation {
  const {
    policy,
    ageBand,
    guardianVerified,
    socialEnabled,
    notificationsEnabled,
    agreements,
    platformAgeSignal,
    platformAgeSignalRequired,
  } = input;
  if (!policy) {
    const unavailable = denied("identity_policy_unavailable");
    return {
      learning: unavailable,
      social: unavailable,
      notifications: unavailable,
      termsAccepted: false,
      privacyNoticeAcknowledged: false,
      guardianVerified,
      onboardingComplete: false,
    };
  }

  const terms = latestAgreement(agreements, "terms_acceptance");
  const privacy = latestAgreement(agreements, "privacy_notice_acknowledgement");
  const social = latestAgreement(agreements, "social");
  const notifications = latestAgreement(agreements, "notifications");
  const minor = ageBand === "13_15" || ageBand === "16_17";
  const requiredLegalActor = minor ? "guardian" : "self";
  const termsAccepted = Boolean(
    terms?.granted
      && terms.documentVersion === policy.termsVersion
      && terms.actorRole === requiredLegalActor,
  );
  const privacyNoticeAcknowledged = Boolean(
    privacy?.granted
      && privacy.documentVersion === policy.privacyNoticeVersion
      && privacy.actorRole === requiredLegalActor,
  );

  let learning: EligibilityDecision;
  if (!ageBand) learning = denied("age_profile_required");
  else if (ageBand === "under_13") learning = denied("under_13_not_supported");
  else if (!termsAccepted) learning = denied("terms_acceptance_required");
  else if (ageBand !== "18_plus" && !guardianVerified) learning = denied("guardian_verification_required");
  else learning = ELIGIBLE;

  const platformAgeConsistency = evaluatePlatformAgeConsistency({
    selfDeclaredAgeBand: ageBand,
    signal: platformAgeSignal,
  });
  if (learning.eligible && !platformAgeConsistency.eligible) learning = platformAgeConsistency;

  const socialActorAllowed = social?.actorRole === (minor ? "guardian" : "self");
  const notificationsActorAllowed = notifications?.actorRole === (minor ? "guardian" : "self");
  const socialAllowed = Boolean(
    socialEnabled
      && social?.granted
      && social.documentVersion === policy.policyVersion
      && socialActorAllowed,
  );
  const notificationsAllowed = Boolean(
    notificationsEnabled
      && notifications?.granted
      && notifications.documentVersion === policy.policyVersion
      && notificationsActorAllowed,
  );
  const platformAgeDecision = evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: ageBand,
    signal: platformAgeSignal,
    required: platformAgeSignalRequired,
  });

  const socialDecision = !learning.eligible
    ? learning
    : !platformAgeDecision.eligible
      ? platformAgeDecision
      : socialAllowed
        ? ELIGIBLE
        : denied("social_permission_required");
  const notificationsDecision = !learning.eligible
    ? learning
    : !platformAgeDecision.eligible
      ? platformAgeDecision
      : notificationsAllowed
        ? ELIGIBLE
        : denied("notifications_permission_required");

  return {
    learning,
    social: socialDecision,
    notifications: notificationsDecision,
    termsAccepted,
    privacyNoticeAcknowledged,
    guardianVerified,
    onboardingComplete: learning.eligible && privacyNoticeAcknowledged,
  };
}
