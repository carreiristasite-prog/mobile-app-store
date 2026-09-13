import assert from "node:assert/strict";
import test from "node:test";
import type { RevenueCatConfig } from "../config.ts";
import { RetryableWorkerError } from "../errors.ts";
import { RevenueCatClient } from "./revenuecat.ts";

const config: RevenueCatConfig = {
  secretApiKey: "sk_test_only_1234567890",
  projectId: "proj123456",
  environment: "production",
  timeoutMs: 1_000,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function subscriptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [{
      gives_access: true,
      environment: "production",
      product_id: "prod123",
      current_period_starts_at: 2_050_000_000_000,
      current_period_ends_at: 2_100_000_000_000,
      store: "app_store",
      entitlements: { items: [{ lookup_key: "pro" }], next_page: null },
      ...overrides,
    }],
    next_page: null,
  };
}

test("grants only exact Pro entitlement and exact store SKU from server data", async () => {
  const calls: URL[] = [];
  const client = new RevenueCatClient(config, async (input) => {
    const url = new URL(input.toString());
    calls.push(url);
    return url.pathname.endsWith("/subscriptions")
      ? json(subscriptions())
      : json({ id: "prod123", store_identifier: "iaaprova.pro.monthly" });
  });
  const state = await client.lookupPro("user-1", new AbortController().signal);
  assert.equal(state?.active, true);
  assert.equal(state?.entitlementKey, "pro");
  assert.equal(state?.productSku, "iaaprova.pro.monthly");
  assert.equal(state?.store, "APP_STORE");
  assert.equal(state?.environment, "production");
  assert.equal(calls.length, 2);
});

test("wrong entitlement, environment or product never grants access", async () => {
  for (const firstPage of [
    subscriptions({ entitlements: { items: [{ lookup_key: "attacker" }], next_page: null } }),
    subscriptions({ environment: "sandbox" }),
  ]) {
    const client = new RevenueCatClient(config, async () => json(firstPage));
    assert.equal(await client.lookupPro("user-1", new AbortController().signal), null);
  }
  const client = new RevenueCatClient(config, async (input) => new URL(input.toString()).pathname.endsWith("/subscriptions")
    ? json(subscriptions())
    : json({ store_identifier: "attacker.sku" }));
  assert.equal(await client.lookupPro("user-1", new AbortController().signal), null);
});

test("unknown stores and cross-origin pagination fail closed", async () => {
  const invalidStore = new RevenueCatClient(config, async (input) => new URL(input.toString()).pathname.endsWith("/subscriptions")
    ? json(subscriptions({ store: "external" }))
    : json({ store_identifier: "iaaprova.pro.monthly" }));
  await assert.rejects(
    invalidStore.lookupPro("user-1", new AbortController().signal),
    RetryableWorkerError,
  );

  const pagination = new RevenueCatClient(config, async () => json({
    items: [],
    next_page: "https://attacker.example/steal",
  }));
  await assert.rejects(
    pagination.lookupPro("user-1", new AbortController().signal),
    /revenuecat_pagination_rejected/,
  );
});
