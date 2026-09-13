import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateOnboarding,
  evaluatePlatformAgeSignal,
  identityPolicySnapshotMatches,
  loadIdentityPolicy,
  type AgreementRecord,
  type IdentityPolicy,
} from "./identity-policy.ts";

test("policy snapshot requires exact policy, terms and privacy versions", () => {
  assert.equal(identityPolicySnapshotMatches({
    policyVersion: policy.policyVersion,
    termsVersion: policy.termsVersion,
    privacyNoticeVersion: policy.privacyNoticeVersion,
  }, policy), true);
  assert.equal(identityPolicySnapshotMatches({
    policyVersion: policy.policyVersion,
    termsVersion: "stale-terms",
    privacyNoticeVersion: policy.privacyNoticeVersion,
  }, policy), false);
  assert.equal(identityPolicySnapshotMatches({
    policyVersion: "stale-policy",
    termsVersion: policy.termsVersion,
    privacyNoticeVersion: policy.privacyNoticeVersion,
  }, policy), false);
});

const policy: IdentityPolicy = {
  policyVersion: "2026-08-21.1",
  termsVersion: "terms-2026-08-21",
  privacyNoticeVersion: "privacy-2026-08-21",
  guardianInviteTtlSeconds: 604_800,
};

function evaluate(
  input: Omit<Parameters<typeof evaluateOnboarding>[0], "socialEnabled" | "notificationsEnabled" | "platformAgeSignal" | "platformAgeSignalRequired">
    & Partial<Pick<Parameters<typeof evaluateOnboarding>[0], "socialEnabled" | "notificationsEnabled" | "platformAgeSignal" | "platformAgeSignalRequired">>,
) {
  return evaluateOnboarding({
    ...input,
    socialEnabled: input.socialEnabled ?? false,
    notificationsEnabled: input.notificationsEnabled ?? false,
    platformAgeSignal: input.platformAgeSignal ?? null,
    platformAgeSignalRequired: input.platformAgeSignalRequired ?? false,
  });
}

function agreement(
  id: string,
  kind: AgreementRecord["kind"],
  granted = true,
  actorRole: AgreementRecord["actorRole"] = "self",
  documentVersion = kind === "terms_acceptance"
    ? policy.termsVersion
    : kind === "privacy_notice_acknowledgement"
      ? policy.privacyNoticeVersion
      : policy.policyVersion,
): AgreementRecord {
  return { id, kind, granted, actorRole, documentVersion, recordedAt: new Date(`2026-08-21T00:00:0${id}Z`) };
}

test("adult needs age and current affirmative terms", () => {
  assert.equal(evaluate({ policy, ageBand: null, guardianVerified: false, agreements: [] }).learning.reason, "age_profile_required");
  assert.equal(evaluate({ policy, ageBand: "18_plus", guardianVerified: false, agreements: [] }).learning.reason, "terms_acceptance_required");
  assert.deepEqual(
    evaluate({ policy, ageBand: "18_plus", guardianVerified: false, agreements: [agreement("1", "terms_acceptance")] }).learning,
    { eligible: true, reason: "eligible" },
  );
});

test("minor needs verified guardian and guardian permissions remain separate", () => {
  const selfLegal = [agreement("1", "terms_acceptance"), agreement("2", "privacy_notice_acknowledgement")];
  assert.equal(
    evaluate({ policy, ageBand: "13_15", guardianVerified: true, agreements: selfLegal }).learning.reason,
    "terms_acceptance_required",
  );
  const base = [
    agreement("3", "terms_acceptance", true, "guardian"),
    agreement("4", "privacy_notice_acknowledgement", true, "guardian"),
  ];
  assert.equal(evaluate({ policy, ageBand: "13_15", guardianVerified: false, agreements: base }).learning.reason, "guardian_verification_required");
  const verified = evaluate({ policy, ageBand: "16_17", guardianVerified: true, agreements: base });
  assert.equal(verified.learning.eligible, true);
  assert.equal(verified.social.reason, "social_permission_required");
  assert.equal(verified.notifications.reason, "notifications_permission_required");

  const permissions = [
    ...base,
    agreement("5", "social", true, "guardian"),
    agreement("6", "notifications", true, "guardian"),
  ];
  const allowed = evaluate({
    policy,
    ageBand: "13_15",
    guardianVerified: true,
    socialEnabled: true,
    notificationsEnabled: true,
    agreements: permissions,
  });
  assert.equal(allowed.social.eligible, true);
  assert.equal(allowed.notifications.eligible, true);
});

test("adult must affirm current legal documents as self after leaving a guardian flow", () => {
  const guardianLegal = [
    agreement("1", "terms_acceptance", true, "guardian"),
    agreement("2", "privacy_notice_acknowledgement", true, "guardian"),
  ];
  const result = evaluate({
    policy,
    ageBand: "18_plus",
    guardianVerified: false,
    agreements: guardianLegal,
  });
  assert.equal(result.learning.reason, "terms_acceptance_required");
  assert.equal(result.privacyNoticeAcknowledged, false);
});

test("under 13 is always ineligible and gets no optional access", () => {
  const result = evaluate({
    policy,
    ageBand: "under_13",
    guardianVerified: true,
    agreements: [
      agreement("1", "terms_acceptance"),
      agreement("2", "social", true, "guardian"),
      agreement("3", "notifications", true, "guardian"),
    ],
  });
  assert.equal(result.learning.reason, "under_13_not_supported");
  assert.equal(result.social.eligible, false);
  assert.equal(result.notifications.eligible, false);
});

test("privacy notice acknowledgement is not terms or optional consent", () => {
  const termsOnly = evaluate({
    policy,
    ageBand: "18_plus",
    guardianVerified: false,
    agreements: [agreement("1", "terms_acceptance")],
  });
  assert.equal(termsOnly.learning.eligible, true);
  assert.equal(termsOnly.privacyNoticeAcknowledged, false);
  assert.equal(termsOnly.onboardingComplete, false);

  const revokedSocial = evaluate({
    policy,
    ageBand: "18_plus",
    guardianVerified: false,
    agreements: [agreement("1", "terms_acceptance"), agreement("2", "social"), agreement("3", "social", false)],
  });
  assert.equal(revokedSocial.social.eligible, false);
  assert.equal(revokedSocial.termsAccepted, true);
});

test("a stale optional grant cannot override the current protective setting", () => {
  const agreements = [agreement("1", "terms_acceptance"), agreement("2", "social")];
  assert.equal(evaluate({
    policy,
    ageBand: "18_plus",
    guardianVerified: false,
    socialEnabled: false,
    agreements,
  }).social.reason, "social_permission_required");
  assert.equal(evaluate({
    policy,
    ageBand: "18_plus",
    guardianVerified: false,
    socialEnabled: true,
    agreements,
  }).social.eligible, true);
});

test("required document versions fail closed", () => {
  const oldTerms = agreement("1", "terms_acceptance", true, "self", "terms-old");
  assert.equal(evaluate({ policy, ageBand: "18_plus", guardianVerified: false, agreements: [oldTerms] }).learning.reason, "terms_acceptance_required");
  assert.equal(evaluate({ policy: null, ageBand: "18_plus", guardianVerified: false, agreements: [agreement("2", "terms_acceptance")] }).learning.reason, "identity_policy_unavailable");
  assert.throws(() => loadIdentityPolicy({}), /IDENTITY_POLICY_VERSION/);
});

test("required store signal never lets a device payload elevate optional capabilities", () => {
  assert.deepEqual(evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: "18_plus",
    signal: null,
    required: true,
  }), { eligible: false, reason: "platform_age_signal_required" });
  assert.deepEqual(evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: "18_plus",
    signal: { status: "shared", ageBand: "18_plus", trust: "device_reported_monitoring" },
    required: true,
  }), { eligible: false, reason: "platform_age_signal_unverified" });
  assert.deepEqual(evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: "18_plus",
    signal: { status: "shared", ageBand: "18_plus", trust: "server_verified" },
    required: true,
  }), { eligible: true, reason: "eligible" });
});

test("minor, unavailable and conflicting store signals fail closed", () => {
  assert.equal(evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: "18_plus",
    signal: { status: "shared", ageBand: "16_17", trust: "device_reported_monitoring" },
    required: true,
  }).reason, "platform_age_signal_minor");
  assert.equal(evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: "18_plus",
    signal: { status: "error", ageBand: null, trust: "device_reported_monitoring" },
    required: true,
  }).reason, "platform_age_signal_unavailable");
  assert.equal(evaluatePlatformAgeSignal({
    selfDeclaredAgeBand: "16_17",
    signal: { status: "shared", ageBand: "18_plus", trust: "server_verified" },
    required: true,
  }).reason, "platform_age_signal_conflict");
});

test("a shared store band that contradicts self-declaration blocks the learning identity flow", () => {
  const conflictingAdult = evaluate({
    policy,
    ageBand: "18_plus",
    guardianVerified: false,
    agreements: [
      agreement("1", "terms_acceptance"),
      agreement("2", "privacy_notice_acknowledgement"),
    ],
    platformAgeSignal: {
      status: "shared",
      ageBand: "16_17",
      trust: "device_reported_monitoring",
    },
    platformAgeSignalRequired: true,
  });
  assert.deepEqual(conflictingAdult.learning, {
    eligible: false,
    reason: "platform_age_signal_conflict",
  });
  assert.equal(conflictingAdult.onboardingComplete, false);

  const matchingMinor = evaluate({
    policy,
    ageBand: "16_17",
    guardianVerified: true,
    agreements: [
      agreement("3", "terms_acceptance", true, "guardian"),
      agreement("4", "privacy_notice_acknowledgement", true, "guardian", policy.privacyNoticeVersion),
    ],
    platformAgeSignal: {
      status: "shared",
      ageBand: "16_17",
      trust: "device_reported_monitoring",
    },
    platformAgeSignalRequired: true,
  });
  assert.equal(matchingMinor.learning.eligible, true);
  assert.equal(matchingMinor.social.reason, "platform_age_signal_minor");
});
