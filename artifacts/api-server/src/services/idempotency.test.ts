import assert from "node:assert/strict";
import test from "node:test";
import { deterministicRequestUuid } from "./idempotency.ts";

test("same idempotency scope yields one stable UUID and different users do not collide", () => {
  const first = deterministicRequestUuid("billing:user-a:key-12345678");
  assert.equal(first, deterministicRequestUuid("billing:user-a:key-12345678"));
  assert.notEqual(first, deterministicRequestUuid("billing:user-b:key-12345678"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
