import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  authenticateRevenueCatWebhook,
  isRevenueCatEventContextAllowed,
  isRevenueCatWebhookRequestTarget,
  isRevenueCatProSubscriptionEvent,
  parseRevenueCatEvent,
  RevenueCatWebhookError,
  shouldApplyRevenueCatEvent,
} from "./revenuecat.ts";

const body = Buffer.from('{"event":{"id":"evt-1"}}');
const secret = "test-only-secret";
const timestamp = 1_700_000_000;
const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");

test("captures raw bytes for every Express URL spelling accepted by the webhook route only", () => {
  assert.equal(isRevenueCatWebhookRequestTarget("/api/v1/billing/webhooks/revenuecat"), true);
  assert.equal(isRevenueCatWebhookRequestTarget("/api/v1/billing/webhooks/revenuecat?environment=production"), true);
  assert.equal(isRevenueCatWebhookRequestTarget("/api/v1/billing/webhooks/revenuecat/"), true);
  assert.equal(isRevenueCatWebhookRequestTarget("/api/v1/billing/webhooks/revenuecat-attacker"), false);
  assert.equal(isRevenueCatWebhookRequestTarget("/v1/billing/webhooks/revenuecat"), false);
  assert.equal(isRevenueCatWebhookRequestTarget(undefined), false);
});

test("accepts a current HMAC and rejects tampering and stale replay", () => {
  assert.equal(authenticateRevenueCatWebhook({
    rawBody: body,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    signingSecret: secret,
    nowMs: timestamp * 1_000,
  }), "hmac");
  assert.throws(() => authenticateRevenueCatWebhook({
    rawBody: Buffer.from('{"event":{"id":"evt-attacker"}}'),
    signatureHeader: `t=${timestamp},v1=${signature}`,
    signingSecret: secret,
    nowMs: timestamp * 1_000,
  }), RevenueCatWebhookError);
  assert.throws(() => authenticateRevenueCatWebhook({
    rawBody: body,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    signingSecret: secret,
    nowMs: (timestamp + 301) * 1_000,
  }), RevenueCatWebhookError);
});

test("authorization fallback uses an exact constant-time comparison", () => {
  assert.equal(authenticateRevenueCatWebhook({ authorizationHeader: "Bearer expected", expectedAuthorization: "Bearer expected" }), "authorization");
  assert.throws(() => authenticateRevenueCatWebhook({ authorizationHeader: "Bearer attacker", expectedAuthorization: "Bearer expected" }), RevenueCatWebhookError);
});

test("parses numeric-string timestamps and server-authoritative status", () => {
  const event = parseRevenueCatEvent({ event: {
    id: "evt-2",
    type: "REFUND",
    app_user_id: "3d813cbb-9b9c-40b6-932f-e66d5b64bdd5",
    entitlement_ids: ["pro"],
    event_timestamp_ms: "1700000000000",
    purchased_at_ms: "1690000000000",
    expiration_at_ms: "1710000000000",
    environment: "PRODUCTION",
    store: "APP_STORE",
  } });
  assert.equal(event.status, "revoked");
  assert.equal(event.occurredAt.toISOString(), "2023-11-14T22:13:20.000Z");
});

test("unknown event types and wrong products never grant Pro", () => {
  const base = {
    id: "evt-unknown",
    app_user_id: "3d813cbb-9b9c-40b6-932f-e66d5b64bdd5",
    entitlement_ids: ["pro"],
    event_timestamp_ms: 1_700_000_000_000,
    product_id: "iaaprova.pro.monthly",
    expiration_at_ms: 1_800_000_000_000,
    environment: "PRODUCTION",
    store: "APP_STORE",
  };
  const unknown = parseRevenueCatEvent({ event: { ...base, type: "FUTURE_UNKNOWN_EVENT" } });
  assert.equal(unknown.status, null);
  assert.equal(isRevenueCatProSubscriptionEvent(unknown), false);
  const wrongProduct = parseRevenueCatEvent({ event: { ...base, id: "evt-wrong", type: "INITIAL_PURCHASE", product_id: "attacker.sku" } });
  assert.equal(isRevenueCatProSubscriptionEvent(wrongProduct), false);
  assert.throws(() => parseRevenueCatEvent({ event: { ...base, id: "evt-no-time", type: "INITIAL_PURCHASE", event_timestamp_ms: undefined } }), RevenueCatWebhookError);
});

test("resolves every RevenueCat identity field and enforces environment/store", () => {
  const event = parseRevenueCatEvent({ event: {
    id: "evt-identities",
    type: "RENEWAL",
    app_user_id: "10000000-0000-4000-8000-000000000001",
    original_app_user_id: "legacy-clerk-subject",
    aliases: ["legacy-alias", "legacy-clerk-subject"],
    entitlement_ids: ["pro"],
    product_id: "iaaprova.pro.monthly:monthly-auto-renewing",
    event_timestamp_ms: 1_700_000_000_000,
    expiration_at_ms: 1_800_000_000_000,
    environment: "PRODUCTION",
    store: "PLAY_STORE",
  } });
  assert.deepEqual(event.identityCandidates, [
    "10000000-0000-4000-8000-000000000001",
    "legacy-clerk-subject",
    "legacy-alias",
  ]);
  assert.equal(isRevenueCatEventContextAllowed(event, "production", new Set(["APP_STORE", "PLAY_STORE"])), true);
  assert.equal(isRevenueCatEventContextAllowed(event, "sandbox", new Set(["APP_STORE", "PLAY_STORE"])), false);
  assert.equal(isRevenueCatProSubscriptionEvent(event), true);
});

test("lifecycle grants only with explicit future evidence and fails closed for transfer/grants", () => {
  const base = {
    app_user_id: "10000000-0000-4000-8000-000000000001",
    entitlement_ids: ["pro"],
    product_id: "iaaprova.pro.monthly",
    event_timestamp_ms: 1_700_000_000_000,
    expiration_at_ms: 1_800_000_000_000,
    environment: "PRODUCTION",
    store: "APP_STORE",
  };
  const grace = parseRevenueCatEvent({ event: {
    ...base, id: "evt-grace", type: "BILLING_ISSUE", grace_period_expiration_at_ms: 1_750_000_000_000,
  } });
  assert.equal(grace.status, "grace_period");
  assert.equal(isRevenueCatProSubscriptionEvent(grace), true);
  assert.equal(parseRevenueCatEvent({ event: { ...base, id: "evt-bad-grace", type: "BILLING_ISSUE", grace_period_expiration_at_ms: null } }).status, null);
  assert.equal(parseRevenueCatEvent({ event: { ...base, id: "evt-pause", type: "SUBSCRIPTION_PAUSED", auto_resume_at_ms: 1_750_000_000_000 } }).status, "paused");
  assert.equal(parseRevenueCatEvent({ event: { ...base, id: "evt-refund-reversed", type: "REFUND_REVERSED" } }).status, "active");
  assert.equal(parseRevenueCatEvent({ event: { ...base, id: "evt-transfer", type: "TRANSFER" } }).status, null);
  assert.equal(parseRevenueCatEvent({ event: { ...base, id: "evt-temp", type: "TEMPORARY_ENTITLEMENT_GRANT" } }).status, null);
});

test("older events cannot overwrite a newer entitlement", () => {
  const current = { occurredAt: new Date("2026-01-02T00:00:00Z"), eventId: "evt-z" };
  assert.equal(shouldApplyRevenueCatEvent(current, { occurredAt: new Date("2026-01-01T00:00:00Z"), eventId: "evt-new" }), false);
  assert.equal(shouldApplyRevenueCatEvent(current, { occurredAt: new Date("2026-01-03T00:00:00Z"), eventId: "evt-new" }), true);
  assert.equal(shouldApplyRevenueCatEvent(current, { occurredAt: current.occurredAt, eventId: "evt-a" }), false);
});
