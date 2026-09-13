import { createHmac, timingSafeEqual } from "node:crypto";

export const REVENUECAT_PRO_PRODUCTS = {
  APP_STORE: "iaaprova.pro.monthly",
  PLAY_STORE: "iaaprova.pro.monthly:monthly-auto-renewing",
} as const;

export type RevenueCatStore = keyof typeof REVENUECAT_PRO_PRODUCTS;
export type RevenueCatEnvironment = "production" | "sandbox";
export type RevenueCatEntitlementStatus =
  | "active"
  | "grace_period"
  | "paused"
  | "expired"
  | "revoked";

export type RevenueCatEvent = {
  id: string;
  type: string;
  appUserId: string;
  originalAppUserId: string | null;
  aliases: string[];
  identityCandidates: string[];
  entitlementIds: string[];
  productId: string;
  store: RevenueCatStore | null;
  environment: RevenueCatEnvironment | null;
  originalTransactionId: string | null;
  occurredAt: Date;
  startsAt: Date;
  expiresAt: Date | null;
  gracePeriodExpiresAt: Date | null;
  autoResumeAt: Date | null;
  status: RevenueCatEntitlementStatus | null;
  payload: Record<string, unknown>;
};

export class RevenueCatWebhookError extends Error {
  readonly reason: "not_configured" | "unauthorized" | "invalid_event";

  constructor(reason: "not_configured" | "unauthorized" | "invalid_event") {
    super(reason);
    this.reason = reason;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function numericTimestamp(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dateFromMilliseconds(value: unknown, fallback: Date | null): Date | null {
  const milliseconds = numericTimestamp(value);
  if (milliseconds === null) return fallback;
  const valueAsDate = new Date(milliseconds);
  return Number.isNaN(valueAsDate.getTime()) ? fallback : valueAsDate;
}

function parseSignature(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[a-fA-F0-9]{64}$/.test(value)) signatures.push(value.toLowerCase());
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
}

function boundedIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 100 ? normalized : null;
}

function parseAliases(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new RevenueCatWebhookError("invalid_event");
  const aliases = value.map(boundedIdentity);
  if (aliases.some((alias) => alias === null)) throw new RevenueCatWebhookError("invalid_event");
  return [...new Set(aliases as string[])];
}

function normalizeStore(value: unknown): RevenueCatStore | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "APP_STORE" || normalized === "PLAY_STORE" ? normalized : null;
}

function normalizeEnvironment(value: unknown): RevenueCatEnvironment | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "production" || normalized === "sandbox" ? normalized : null;
}

export function isRevenueCatWebhookRequestTarget(url: string | undefined): boolean {
  if (!url) return false;
  const pathname = url.split("?", 1)[0].replace(/\/+$/, "");
  return pathname === "/api/v1/billing/webhooks/revenuecat";
}

export function authenticateRevenueCatWebhook(input: {
  rawBody?: Buffer;
  signatureHeader?: string;
  authorizationHeader?: string;
  signingSecret?: string;
  expectedAuthorization?: string;
  nowMs?: number;
}): "hmac" | "authorization" {
  if (!input.signingSecret && !input.expectedAuthorization) {
    throw new RevenueCatWebhookError("not_configured");
  }
  if (input.signingSecret) {
    const signature = parseSignature(input.signatureHeader ?? "");
    const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
    if (!input.rawBody || !signature || Math.abs(nowSeconds - signature.timestamp) > 300) {
      throw new RevenueCatWebhookError("unauthorized");
    }
    const expected = createHmac("sha256", input.signingSecret)
      .update(`${signature.timestamp}.`)
      .update(input.rawBody)
      .digest("hex");
    if (!signature.signatures.some((candidate) => safeEqual(expected, candidate))) {
      throw new RevenueCatWebhookError("unauthorized");
    }
    return "hmac";
  }
  if (!safeEqual(input.authorizationHeader ?? "", input.expectedAuthorization!)) {
    throw new RevenueCatWebhookError("unauthorized");
  }
  return "authorization";
}

export function parseRevenueCatEvent(body: unknown): RevenueCatEvent {
  if (!body || typeof body !== "object" || !("event" in body)) {
    throw new RevenueCatWebhookError("invalid_event");
  }
  const event = (body as { event: unknown }).event;
  if (!event || typeof event !== "object") throw new RevenueCatWebhookError("invalid_event");
  const payload = event as Record<string, unknown>;
  const id = String(payload.id ?? payload.event_id ?? "").trim();
  const type = String(payload.type ?? "").trim().toUpperCase();
  const appUserId = boundedIdentity(payload.app_user_id);
  const originalAppUserId = boundedIdentity(payload.original_app_user_id);
  const aliases = parseAliases(payload.aliases);
  const identityCandidates = [...new Set([appUserId, originalAppUserId, ...aliases].filter((value): value is string => value !== null))];
  if (!id || id.length > 255 || !type || type.length > 80 || identityCandidates.length === 0) {
    throw new RevenueCatWebhookError("invalid_event");
  }

  const occurredAt = dateFromMilliseconds(payload.event_timestamp_ms, null);
  if (!occurredAt) throw new RevenueCatWebhookError("invalid_event");
  const startsAt = dateFromMilliseconds(payload.purchased_at_ms, occurredAt)!;
  const expiresAt = dateFromMilliseconds(payload.expiration_at_ms, null);
  const gracePeriodExpiresAt = dateFromMilliseconds(payload.grace_period_expiration_at_ms, null);
  const autoResumeAt = dateFromMilliseconds(payload.auto_resume_at_ms, null);
  const entitlementIds = Array.isArray(payload.entitlement_ids)
    ? payload.entitlement_ids.map(String).filter(Boolean)
    : [String(payload.entitlement_id ?? "")].filter(Boolean);
  const store = normalizeStore(payload.store);
  const environment = normalizeEnvironment(payload.environment);

  let status: RevenueCatEntitlementStatus | null = null;
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
    case "REFUND_REVERSED":
    case "CANCELLATION":
      status = expiresAt && expiresAt > occurredAt ? "active" : null;
      break;
    case "BILLING_ISSUE":
      status = gracePeriodExpiresAt && gracePeriodExpiresAt > occurredAt ? "grace_period" : null;
      break;
    case "SUBSCRIPTION_PAUSED":
      status = autoResumeAt && autoResumeAt > occurredAt ? "paused" : null;
      break;
    case "EXPIRATION":
      status = "expired";
      break;
    case "REFUND":
      status = "revoked";
      break;
    case "TRANSFER":
    case "TEMPORARY_ENTITLEMENT_GRANT":
      // These never grant directly. A durable server lookup converges safely.
      status = null;
      break;
    default:
      status = null;
  }

  return {
    id,
    type,
    appUserId: appUserId ?? identityCandidates[0],
    originalAppUserId,
    aliases,
    identityCandidates,
    entitlementIds,
    productId: String(payload.product_id ?? "").trim(),
    store,
    environment,
    originalTransactionId: payload.original_transaction_id ? String(payload.original_transaction_id).slice(0, 255) : null,
    occurredAt,
    startsAt,
    expiresAt,
    gracePeriodExpiresAt,
    autoResumeAt,
    status,
    payload,
  };
}

export function revenueCatProductForStore(store: RevenueCatStore): string {
  return REVENUECAT_PRO_PRODUCTS[store];
}

export function isRevenueCatEventContextAllowed(
  event: RevenueCatEvent,
  expectedEnvironment: RevenueCatEnvironment,
  allowedStores: ReadonlySet<RevenueCatStore>,
): boolean {
  return event.environment === expectedEnvironment
    && event.store !== null
    && allowedStores.has(event.store);
}

export function isRevenueCatProSubscriptionEvent(event: RevenueCatEvent): boolean {
  return event.status !== null
    && event.store !== null
    && event.entitlementIds.includes("pro")
    && event.productId === revenueCatProductForStore(event.store);
}

export function shouldApplyRevenueCatEvent(
  current: { occurredAt: Date; eventId: string } | null,
  incoming: { occurredAt: Date; eventId: string },
): boolean {
  if (!current) return true;
  const timeDifference = incoming.occurredAt.getTime() - current.occurredAt.getTime();
  if (timeDifference !== 0) return timeDifference > 0;
  return incoming.eventId.localeCompare(current.eventId) > 0;
}
