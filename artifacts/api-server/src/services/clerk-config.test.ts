import assert from "node:assert/strict";
import { test } from "node:test";
import { assertClerkConfiguration } from "./clerk-config.ts";

test("Clerk não é obrigatório fora de produção", () => {
  assert.doesNotThrow(() => assertClerkConfiguration({ NODE_ENV: "development" }));
});

test("produção falha fechada quando as chaves do Clerk estão ausentes", () => {
  assert.throws(
    () => assertClerkConfiguration({ NODE_ENV: "production" }),
    /CLERK_SECRET_KEY/,
  );
});

test("produção rejeita chaves de teste do Clerk", () => {
  assert.throws(
    () => assertClerkConfiguration({
      NODE_ENV: "production",
      CLERK_SECRET_KEY: "sk_test_not-for-production",
      CLERK_PUBLISHABLE_KEY: "pk_test_not-for-production",
    }),
    /CLERK_SECRET_KEY/,
  );
});

test("produção aceita somente o par de chaves live", () => {
  assert.doesNotThrow(() => assertClerkConfiguration({
    NODE_ENV: "production",
    CLERK_SECRET_KEY: "sk_live_valid-secret",
    CLERK_PUBLISHABLE_KEY: "pk_live_valid-publishable",
  }));
});
