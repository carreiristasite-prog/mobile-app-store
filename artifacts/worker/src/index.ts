import { WorkerEngine } from "./engine.ts";
import { safeErrorCode } from "./errors.ts";
import { createHandlerRegistry } from "./handlers.ts";
import { HealthServer } from "./health.ts";
import { RevenueCatClient } from "./integrations/revenuecat.ts";
import {
  ClerkRevenueCatPrivacyProviders,
  GcsPrivateObjectStorage,
  PrivacyProcessingService,
} from "./integrations/privacy.ts";
import { logger } from "./logger.ts";
import { createPostgresPool, PostgresWorkerRepository } from "./repository.ts";
import { loadConfig } from "./config.ts";

function timeout(milliseconds: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), milliseconds);
    timer.unref();
  });
}

async function run(): Promise<void> {
  const config = loadConfig();
  const pool = createPostgresPool(config.databaseUrl);
  const repository = new PostgresWorkerRepository(pool);
  const revenueCat = config.revenueCat ? new RevenueCatClient(config.revenueCat) : null;
  const privacyAdapter = config.privacy && config.revenueCat
    ? new PrivacyProcessingService(
      repository,
      new GcsPrivateObjectStorage(config.privacy),
      new ClerkRevenueCatPrivacyProviders(config.privacy, config.revenueCat),
      config.privacy,
    )
    : null;
  // loadConfig fails production startup when the reviewed retention policy or
  // any required provider is absent. Non-production without all adapters keeps
  // DSR jobs retryable and never marks them completed.
  const handlers = createHandlerRegistry({ repository, revenueCat, privacyAdapter });
  const engine = new WorkerEngine(repository, handlers, logger, {
    ...config,
    billingReconciliationEnabled: revenueCat !== null,
    billingReconciliationBatchSize: config.batchSize,
  });
  const stopClaiming = new AbortController();
  let shuttingDown = false;
  let unhealthyExit = false;
  let requestStop!: () => void;
  const stopped = new Promise<void>((resolve) => { requestStop = resolve; });
  const health = new HealthServer(
    repository,
    config.maxAttempts,
    [...handlers.keys()] as import("./types.ts").SupportedEventType[],
    () => shuttingDown,
    logger,
  );

  const stop = (errorCode: string, unhealthy = false): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    unhealthyExit = unhealthy;
    logger.info({ status: "stopping", errorCode }, "worker_shutdown_requested");
    stopClaiming.abort();
    requestStop();
  };
  const onSigterm = (): void => stop("sigterm");
  const onSigint = (): void => stop("sigint");
  const onUncaught = (): void => stop("uncaught_exception", true);
  const onUnhandled = (): void => stop("unhandled_rejection", true);
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  process.once("uncaughtException", onUncaught);
  process.once("unhandledRejection", onUnhandled);

  try {
    await repository.ping();
    await health.listen(config.healthPort);
    logger.info({ status: "ready" }, "worker_started");
    const engineRun = engine.run(stopClaiming.signal);
    await stopped;

    const firstDrain = await Promise.race([
      engineRun.then(() => "drained" as const),
      timeout(config.shutdownTimeoutMs),
    ]);
    if (firstDrain === "timeout") {
      unhealthyExit = true;
      logger.warn({ status: "forcing", errorCode: "shutdown_timeout" }, "worker_shutdown_forcing");
      engine.abortActive();
      await Promise.race([engineRun, timeout(1_000)]);
    }
  } finally {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
    await health.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    logger.info({ status: "stopped" }, "worker_stopped");
    if (unhealthyExit) process.exitCode = 1;
  }
}

run().catch((error) => {
  logger.error({ errorCode: safeErrorCode(error) }, "worker_startup_failed");
  process.exitCode = 1;
});
