import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideGuardianInviteAcceptance,
  deriveGuardianInviteToken,
  digestGuardianInviteToken,
  guardianInviteReplayMatches,
  guardianInviteTokenMatches,
} from "./guardian-invite.ts";

const secret = "test-only-secret-with-at-least-thirty-two-bytes";

test("invitation token is deterministic per idempotency key and only its digest is persisted", () => {
  const token = deriveGuardianInviteToken(secret, "minor-1", "idem-key-0001");
  assert.equal(token, deriveGuardianInviteToken(secret, "minor-1", "idem-key-0001"));
  assert.notEqual(token, deriveGuardianInviteToken(secret, "minor-1", "idem-key-0002"));
  const digest = digestGuardianInviteToken(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(guardianInviteTokenMatches(token, digest), true);
  assert.equal(guardianInviteTokenMatches(`${token}x`, digest), false);
});

test("acceptance rejects expiration, revocation, non-adult and cross-account replay", () => {
  const base = {
    now: new Date("2026-08-21T12:00:00Z"),
    expiresAt: new Date("2026-08-22T12:00:00Z"),
    revokedAt: null,
    usedAt: null,
    acceptedByUserId: null,
    requestingGuardianUserId: "guardian-1",
    guardianAgeBand: "18_plus",
  };
  assert.equal(decideGuardianInviteAcceptance(base), "accept");
  assert.equal(decideGuardianInviteAcceptance({ ...base, expiresAt: base.now }), "expired");
  assert.equal(decideGuardianInviteAcceptance({ ...base, revokedAt: base.now }), "revoked");
  assert.equal(decideGuardianInviteAcceptance({ ...base, guardianAgeBand: "16_17" }), "guardian_must_be_adult");
  assert.equal(decideGuardianInviteAcceptance({ ...base, usedAt: base.now, acceptedByUserId: "guardian-1" }), "replay");
  assert.equal(decideGuardianInviteAcceptance({
    ...base,
    usedAt: base.now,
    acceptedByUserId: "guardian-1",
    guardianAgeBand: "16_17",
  }), "guardian_must_be_adult");
  assert.equal(decideGuardianInviteAcceptance({ ...base, usedAt: base.now, acceptedByUserId: "guardian-2" }), "already_used");
});

test("cross-key replay requires the exact request hash persisted by first acceptance", () => {
  const firstPayload = "a".repeat(64);
  assert.equal(guardianInviteReplayMatches(firstPayload, firstPayload), true);
  assert.equal(guardianInviteReplayMatches(firstPayload, "b".repeat(64)), false);
  assert.equal(guardianInviteReplayMatches(null, firstPayload), false);
  assert.equal(guardianInviteReplayMatches("legacy", firstPayload), false);
});
