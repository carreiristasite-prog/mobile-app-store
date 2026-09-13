import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type GuardianInviteDecision =
  | "accept"
  | "replay"
  | "expired"
  | "revoked"
  | "already_used"
  | "guardian_must_be_adult";

export function requireGuardianInviteSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.GUARDIAN_INVITE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("GUARDIAN_INVITE_SECRET must contain at least 32 bytes");
  }
  return secret;
}

export function deriveGuardianInviteToken(secret: string, minorUserId: string, idempotencyKey: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("guardian invite secret too short");
  return createHmac("sha256", secret)
    .update("iaaprova.guardian-invite.v1\0")
    .update(minorUserId)
    .update("\0")
    .update(idempotencyKey)
    .digest("base64url");
}

export function digestGuardianInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function guardianInviteTokenMatches(token: string, expectedDigest: string): boolean {
  const actual = Buffer.from(digestGuardianInviteToken(token), "hex");
  const expected = /^[a-f0-9]{64}$/i.test(expectedDigest) ? Buffer.from(expectedDigest, "hex") : Buffer.alloc(0);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function guardianInviteReplayMatches(
  persistedRequestHash: string | null,
  currentRequestHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(persistedRequestHash ?? "") || !/^[a-f0-9]{64}$/.test(currentRequestHash)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(persistedRequestHash!, "hex"),
    Buffer.from(currentRequestHash, "hex"),
  );
}

export function decideGuardianInviteAcceptance(input: {
  now: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  usedAt: Date | null;
  acceptedByUserId: string | null;
  requestingGuardianUserId: string;
  guardianAgeBand: string | null;
}): GuardianInviteDecision {
  if (input.revokedAt) return "revoked";
  if (input.guardianAgeBand !== "18_plus") return "guardian_must_be_adult";
  if (input.usedAt) {
    return input.acceptedByUserId === input.requestingGuardianUserId ? "replay" : "already_used";
  }
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "accept";
}
