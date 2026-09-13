import {
  PRO_ENTITLEMENT_KEY,
  PRO_PRODUCT_SKUS,
  type RevenueCatConfig,
} from "../config.ts";
import { RetryableWorkerError } from "../errors.ts";
import type { ProEntitlementState } from "../types.ts";

const REVENUECAT_ORIGIN = "https://api.revenuecat.com";
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_PAGES = 10;
const ALLOWED_STORES = new Set(["app_store", "play_store"]);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RevenueCatList {
  items: unknown[];
  next_page: string | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function list(value: unknown): RevenueCatList | null {
  const record = object(value);
  if (!record || !Array.isArray(record["items"])) return null;
  const nextPage = record["next_page"];
  if (nextPage !== null && nextPage !== undefined && typeof nextPage !== "string") return null;
  return { items: record["items"], next_page: nextPage ?? null };
}

function milliseconds(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasAllowedEntitlement(subscription: Record<string, unknown>): boolean {
  const entitlements = list(subscription["entitlements"]);
  if (!entitlements) throw new RetryableWorkerError("revenuecat_schema_invalid");
  return entitlements.items.some((item) => object(item)?.["lookup_key"] === PRO_ENTITLEMENT_KEY);
}

function combineSignals(external: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([external, AbortSignal.timeout(timeoutMs)]);
}

export class RevenueCatClient {
  private readonly config: RevenueCatConfig;
  private readonly fetcher: FetchLike;

  constructor(
    config: RevenueCatConfig,
    fetcher: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetcher = fetcher;
  }

  get environment(): "production" | "sandbox" {
    return this.config.environment;
  }

  async lookupPro(customerId: string, signal: AbortSignal): Promise<ProEntitlementState | null> {
    const projectId = encodeURIComponent(this.config.projectId);
    const encodedCustomer = encodeURIComponent(customerId);
    const allowedPrefix = `/v2/projects/${projectId}/customers/${encodedCustomer}/subscriptions`;
    let url: URL | null = new URL(
      `${REVENUECAT_ORIGIN}${allowedPrefix}?environment=${this.config.environment}`,
    );
    const subscriptions: Record<string, unknown>[] = [];

    for (let page = 0; url !== null && page < MAX_PAGES; page += 1) {
      const response = await this.request(url, signal);
      if (response.status === 404) return null;
      const body = await this.parseJson(response);
      const pageData = list(body);
      if (!pageData) throw new RetryableWorkerError("revenuecat_schema_invalid");
      subscriptions.push(...pageData.items.map(object).filter((item): item is Record<string, unknown> => item !== null));
      url = pageData.next_page === null
        ? null
        : this.validatedPaginationUrl(pageData.next_page, allowedPrefix);
      if (page === MAX_PAGES - 1 && url !== null) {
        throw new RetryableWorkerError("revenuecat_pagination_limit");
      }
    }

    const eligible = subscriptions.filter((subscription) => {
      if (subscription["gives_access"] !== true) return false;
      if (subscription["environment"] !== this.config.environment) return false;
      return hasAllowedEntitlement(subscription);
    });

    const verified: ProEntitlementState[] = [];
    for (const subscription of eligible) {
      const productId = subscription["product_id"];
      if (typeof productId !== "string" || productId.length === 0) {
        throw new RetryableWorkerError("revenuecat_schema_invalid");
      }
      const productUrl = new URL(
        `${REVENUECAT_ORIGIN}/v2/projects/${projectId}/products/${encodeURIComponent(productId)}`,
      );
      const productResponse = await this.request(productUrl, signal);
      const product = object(await this.parseJson(productResponse));
      if (!product) throw new RetryableWorkerError("revenuecat_schema_invalid");
      const startsAt = milliseconds(subscription["current_period_starts_at"]);
      const rawExpiresAt = subscription["current_period_ends_at"];
      const expiresAt = rawExpiresAt === null ? null : milliseconds(rawExpiresAt);
      const store = subscription["store"];
      if (
        !startsAt
        || (rawExpiresAt !== null && !expiresAt)
        || typeof store !== "string"
        || !ALLOWED_STORES.has(store)
      ) {
        throw new RetryableWorkerError("revenuecat_schema_invalid");
      }
      const normalizedStore = store === "app_store" ? "APP_STORE" : "PLAY_STORE";
      const expectedProduct = PRO_PRODUCT_SKUS[normalizedStore];
      if (product["store_identifier"] !== expectedProduct) continue;
      if (!expiresAt || expiresAt.getTime() <= Date.now()) continue;
      verified.push({
        active: true,
        entitlementKey: PRO_ENTITLEMENT_KEY,
        productSku: expectedProduct,
        store: normalizedStore,
        environment: this.config.environment,
        startsAt,
        expiresAt,
      });
    }

    return verified.sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())[0] ?? null;
  }

  private validatedPaginationUrl(nextPage: string, allowedPrefix: string): URL {
    const url = new URL(nextPage, REVENUECAT_ORIGIN);
    if (url.origin !== REVENUECAT_ORIGIN || url.pathname !== allowedPrefix) {
      throw new RetryableWorkerError("revenuecat_pagination_rejected");
    }
    const allowedParameters = new Set(["environment", "limit", "starting_after"]);
    for (const key of url.searchParams.keys()) {
      if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) {
        throw new RetryableWorkerError("revenuecat_pagination_rejected");
      }
    }
    const environment = url.searchParams.get("environment");
    if (environment !== null && environment !== this.config.environment) {
      throw new RetryableWorkerError("revenuecat_pagination_rejected");
    }
    url.searchParams.set("environment", this.config.environment);
    return url;
  }

  private async request(url: URL, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.config.secretApiKey}`,
          accept: "application/json",
          "user-agent": "ia-aprova-worker/0.0.0",
        },
        redirect: "error",
        signal: combineSignals(signal, this.config.timeoutMs),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new RetryableWorkerError("revenuecat_network_error");
    }
    if (response.ok || response.status === 404) return response;
    if (response.status === 401 || response.status === 403) {
      throw new RetryableWorkerError("revenuecat_auth_rejected");
    }
    if (response.status === 429) throw new RetryableWorkerError("revenuecat_rate_limited");
    throw new RetryableWorkerError("revenuecat_upstream_error");
  }

  private async parseJson(response: Response): Promise<unknown> {
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new RetryableWorkerError("revenuecat_response_too_large");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new RetryableWorkerError("revenuecat_response_too_large");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RetryableWorkerError("revenuecat_schema_invalid");
    }
  }
}
