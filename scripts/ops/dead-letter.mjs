#!/usr/bin/env node
import {
  OpsError,
  createOpsPool,
  expectedConfirmation,
  guardConnectionEnvironment,
  inspectDeadLetter,
  listDeadLetters,
  previewRequeue,
  requeueDeadLetter,
  validateConfiguredMaxAttempts,
  validateEventId,
  validateMaxAttempts,
} from "./dead-letter-core.mjs";

function usage() {
  return [
    "Usage:",
    "  node scripts/ops/dead-letter.mjs list --max-attempts N [--limit N]",
    "  node scripts/ops/dead-letter.mjs inspect --id UUID --max-attempts N",
    "  node scripts/ops/dead-letter.mjs requeue --id UUID --event-type TYPE --expected-attempts N --max-attempts N --reason reason_code --operator op_pseudonym [--execute --confirm \"...\"]",
    "",
    "Dry-run is the default. The tool never bulk-updates or deletes events.",
  ].join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["list", "inspect", "requeue"]).has(command)) throw new OpsError("command_invalid");
  const values = new Map();
  let execute = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--execute") {
      if (execute) throw new OpsError("argument_duplicate");
      execute = true;
      continue;
    }
    if (!token.startsWith("--")) throw new OpsError("argument_invalid");
    const value = rest[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) throw new OpsError("argument_value_required");
    if (values.has(token)) throw new OpsError("argument_duplicate");
    values.set(token, value);
    index += 1;
  }
  return { command, values, execute };
}

function get(values, key) {
  return values.get(key);
}

function allowedArguments(parsed) {
  const allowed = {
    list: new Set(["--max-attempts", "--limit"]),
    inspect: new Set(["--id", "--max-attempts"]),
    requeue: new Set([
      "--id", "--event-type", "--expected-attempts", "--max-attempts",
      "--reason", "--operator", "--confirm",
    ]),
  }[parsed.command];
  if ([...parsed.values.keys()].some((key) => !allowed.has(key))) throw new OpsError("argument_not_allowed");
  if (parsed.command !== "requeue" && parsed.execute) throw new OpsError("execute_not_allowed");
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  allowedArguments(parsed);
  const guard = guardConnectionEnvironment(process.env, { write: parsed.execute });
  const maxAttempts = validateConfiguredMaxAttempts(
    get(parsed.values, "--max-attempts"),
    guard.workerMaxAttempts,
  );
  const pool = createOpsPool(guard.databaseUrl);
  try {
    if (parsed.command === "list") {
      writeJson(await listDeadLetters(pool, {
        maxAttempts,
        limit: get(parsed.values, "--limit") ?? 25,
      }));
      return;
    }
    if (parsed.command === "inspect") {
      writeJson(await inspectDeadLetter(pool, {
        eventId: get(parsed.values, "--id"),
        maxAttempts,
      }));
      return;
    }

    const base = {
      eventId: validateEventId(get(parsed.values, "--id")),
      eventType: get(parsed.values, "--event-type"),
      expectedAttempts: validateMaxAttempts(get(parsed.values, "--expected-attempts")),
      maxAttempts,
      reasonCode: get(parsed.values, "--reason"),
      operatorId: get(parsed.values, "--operator"),
      environment: guard.environment,
      changeTicket: guard.changeTicket,
    };
    const confirmation = get(parsed.values, "--confirm") ?? "dry-run-confirmation-placeholder";
    if (!parsed.execute) {
      const requiredConfirmation = expectedConfirmation(base);
      writeJson({
        ...(await previewRequeue(pool, { ...base, confirmation: requiredConfirmation })),
        requiredConfirmation,
      });
      return;
    }
    writeJson(await requeueDeadLetter(pool, { ...base, confirmation }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const code = error instanceof OpsError ? error.code : "operation_failed";
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  if (code === "command_invalid") process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
});
