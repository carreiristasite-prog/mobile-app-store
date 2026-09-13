import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { apiReadiness } from "./services/readiness-runtime";
import { assertClerkConfiguration } from "./services/clerk-config";

assertClerkConfiguration();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.fatal({ err }, "Server listener failed");
  process.exitCode = 1;
});

let shutdownStarted = false;
const SHUTDOWN_DEADLINE_MS = 8_000;

function beginShutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  apiReadiness.beginDrain();
  logger.info({ signal }, "Graceful shutdown started");

  const forceExit = setTimeout(() => {
    logger.fatal("Graceful shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  forceExit.unref();

  server.close((serverError) => {
    void pool.end().then(
      () => {
        clearTimeout(forceExit);
        if (serverError) {
          logger.error({ err: serverError }, "HTTP server shutdown failed");
          process.exitCode = 1;
          return;
        }
        logger.info("Graceful shutdown completed");
      },
      (databaseError: unknown) => {
        clearTimeout(forceExit);
        logger.error({ err: databaseError }, "Database pool shutdown failed");
        process.exitCode = 1;
      },
    );
  });
}

process.once("SIGTERM", () => beginShutdown("SIGTERM"));
process.once("SIGINT", () => beginShutdown("SIGINT"));
