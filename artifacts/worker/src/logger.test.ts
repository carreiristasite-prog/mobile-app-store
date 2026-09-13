import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "./logger.ts";
import type { SafeLogFields, SafeLogMessage } from "./types.ts";

test("logger drops unexpected PII/secret fields and rejects arbitrary messages", () => {
  let output = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    logger.info({
      eventId: "10000000-0000-4000-8000-000000000001",
      ...({
        userId: "20000000-0000-4000-8000-000000000002",
        email: "student@example.test",
        secret: "sk_must_not_be_logged",
      } as unknown as SafeLogFields),
    }, "student@example.test" as SafeLogMessage);
  } finally {
    process.stdout.write = original;
  }

  const record = JSON.parse(output) as Record<string, unknown>;
  assert.equal(record["message"], "worker_log_message_rejected");
  assert.equal(record["eventId"], "10000000-0000-4000-8000-000000000001");
  assert.equal("userId" in record, false);
  assert.equal("email" in record, false);
  assert.equal("secret" in record, false);
  assert.doesNotMatch(output, /student@example|sk_must_not_be_logged/);
});
