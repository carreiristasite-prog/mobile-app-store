import type { SafeLogFields, SafeLogger, SafeLogMessage } from "./types.ts";

const ALLOWED_MESSAGES = new Set<SafeLogMessage>([
  "worker_batch_completed",
  "worker_batch_failed",
  "worker_event_dead_lettered",
  "worker_event_fence_rejected",
  "worker_event_retry_scheduled",
  "worker_health_started",
  "worker_shutdown_forcing",
  "worker_shutdown_requested",
  "worker_started",
  "worker_startup_failed",
  "worker_stopped",
]);

function safeFields(input: SafeLogFields): SafeLogFields {
  const output: SafeLogFields = {};
  const stringKeys = ["eventId", "eventType", "errorCode", "status"] as const;
  const numberKeys = [
    "attempt",
    "claimed",
    "processed",
    "retried",
    "deadLettered",
    "durationMs",
    "port",
  ] as const;
  for (const key of stringKeys) {
    const value = input[key];
    if (typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)) {
      output[key] = value;
    }
  }
  for (const key of numberKeys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  return output;
}

function write(
  level: "info" | "warn" | "error",
  fields: SafeLogFields,
  message: SafeLogMessage,
): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: "ia-aprova-worker",
    message: ALLOWED_MESSAGES.has(message) ? message : "worker_log_message_rejected",
    ...safeFields(fields),
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger: SafeLogger = {
  info: (fields, message) => write("info", fields, message),
  warn: (fields, message) => write("warn", fields, message),
  error: (fields, message) => write("error", fields, message),
};
