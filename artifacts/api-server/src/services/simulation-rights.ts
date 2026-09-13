export type SimulationQuestionRightsCandidate = {
  origin: string;
  authorId: string | null;
  sourceTransformation: string | null;
  presentationKind: string;
  sourceId: string | null;
  sourceOwner: string | null;
  sourceContentHash: string | null;
  licenseId: string | null;
  licenseSourceId: string | null;
  licenseType: string | null;
  licensePermissions: string[] | null;
  licenseStatus: string | null;
  licenseTerritory: string | null;
  licensePlatforms: string[] | null;
  licenseStartsAt: Date | null;
  licenseExpiresAt: Date | null;
  licenseEvidenceHash: string | null;
  licenseApprovedBy: string | null;
};

const SHA256 = /^[a-f0-9]{64}$/u;

function supportsBothStorePlatforms(platforms: string[] | null): boolean {
  if (!platforms || platforms.length === 0) return false;
  const normalized = new Set(platforms.map((value) => value.trim().toLowerCase()));
  return normalized.has("ios") && normalized.has("android");
}

function supportsBrazil(territory: string | null): boolean {
  if (!territory) return false;
  return /(^|[,;\s])(br|bra|brasil|brazil)([,;\s]|$)/iu.test(territory);
}

/**
 * Fail-closed runtime gate for text-only simulation questions.
 *
 * Publication state is checked by the selecting query. This predicate proves
 * that the selected item is linked to an independently approved instrument
 * for the same hashed source and that its store scope remains valid for the
 * entire immutable simulation window. It deliberately does not infer rights
 * merely from `original_authoral` or from a publicly accessible source.
 */
export function hasEligibleSimulationQuestionRights(
  question: SimulationQuestionRightsCandidate,
  now: Date,
  requiredThrough: Date,
): boolean {
  const expectedLicenseType = question.origin === "original_authoral"
    ? "authoring_agreement"
    : question.origin === "official_licensed"
      ? "official_license"
      : null;
  if (!expectedLicenseType || !question.licenseId || question.licenseType !== expectedLicenseType) return false;
  if (!question.authorId?.trim() || question.presentationKind !== "text_only") return false;
  if (!question.sourceId || !question.licenseSourceId || question.sourceId !== question.licenseSourceId) return false;
  if (!question.sourceOwner?.trim() || !question.sourceContentHash || !SHA256.test(question.sourceContentHash)) return false;
  if (question.licenseStatus !== "active") return false;
  const permissions = new Set(question.licensePermissions ?? []);
  if (!permissions.has("commercial") || !permissions.has("digital") || !permissions.has("reproduce")) return false;
  if (question.origin === "original_authoral" && question.sourceTransformation !== "original") return false;
  if (question.origin === "official_licensed") {
    if (question.sourceTransformation === "adapted" && !permissions.has("adapt")) return false;
    if (question.sourceTransformation === "fragmented" && !permissions.has("fragment")) return false;
    if (!["verbatim", "adapted", "fragmented"].includes(question.sourceTransformation ?? "")) return false;
  }
  if (!question.licenseEvidenceHash || !SHA256.test(question.licenseEvidenceHash)) return false;
  if (!question.licenseApprovedBy?.trim() || !supportsBrazil(question.licenseTerritory)) return false;
  if (!supportsBothStorePlatforms(question.licensePlatforms)) return false;
  if (!question.licenseStartsAt || question.licenseStartsAt > now) return false;
  if (requiredThrough < now) return false;
  if (question.licenseExpiresAt && question.licenseExpiresAt <= requiredThrough) return false;
  return true;
}
