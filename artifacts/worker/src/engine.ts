import { deterministicBackoffMs } from "./backoff.ts";
import {
  DeferredWorkerError,
  InvalidEventError,
  RetryableWorkerError,
  safeErrorCode,
} from "./errors.ts";
import type {
  HandlerRegistry,
  OutboxEvent,
  SafeLogger,
  SupportedEventType,
  WorkerRepository,
} from "./types.ts";

export interface EngineOptions {
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffJitterRatio: number;
  billingReconciliationEnabled?: boolean;
  billingReconciliationBatchSize?: number;
}

export interface RunSummary {
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class WorkerEngine {
  private readonly active = new Set<AbortController>();
  private readonly repository: WorkerRepository;
  private readonly handlers: HandlerRegistry;
  private readonly logger: SafeLogger;
  private readonly options: EngineOptions;
  private readonly now: () => Date;

  constructor(
    repository: WorkerRepository,
    handlers: HandlerRegistry,
    logger: SafeLogger,
    options: EngineOptions,
    now: () => Date = () => new Date(),
  ) {
    if (handlers.size === 0) throw new Error("At least one worker handler is required");
    this.repository = repository;
    this.handlers = handlers;
    this.logger = logger;
    this.options = options;
    this.now = now;
  }

  async run(stopClaiming: AbortSignal): Promise<void> {
    while (!stopClaiming.aborted) {
      let claimed = 0;
      try {
        const summary = await this.runOnce();
        claimed = summary.claimed;
        if (claimed > 0) this.logger.info(summary, "worker_batch_completed");
      } catch (error) {
        this.logger.error({ errorCode: safeErrorCode(error) }, "worker_batch_failed");
      }
      if (!stopClaiming.aborted && claimed === 0) {
        await wait(this.options.pollIntervalMs, stopClaiming);
      }
    }
  }

  async runOnce(): Promise<RunSummary> {
    if (this.options.billingReconciliationEnabled === true) {
      await this.repository.scheduleDailyBillingReconciliation({
        now: this.now(),
        batchSize: this.options.billingReconciliationBatchSize ?? this.options.batchSize,
      });
    }
    const eventTypes = [...this.handlers.keys()] as SupportedEventType[];
    const events = await this.repository.claimBatch({
      now: this.now(),
      batchSize: this.options.batchSize,
      leaseMs: this.options.leaseMs,
      maxAttempts: this.options.maxAttempts,
      eventTypes,
    });
    const results = await Promise.all(events.map((event) => this.processEvent(event)));
    return results.reduce<RunSummary>((summary, result) => ({
      claimed: summary.claimed + 1,
      processed: summary.processed + (result === "processed" ? 1 : 0),
      retried: summary.retried + (result === "retried" ? 1 : 0),
      deadLettered: summary.deadLettered + (result === "dead_lettered" ? 1 : 0),
    }), { claimed: 0, processed: 0, retried: 0, deadLettered: 0 });
  }

  abortActive(): void {
    for (const controller of this.active) controller.abort();
  }

  get activeCount(): number {
    return this.active.size;
  }

  private async processEvent(
    event: OutboxEvent,
  ): Promise<"processed" | "retried" | "dead_lettered" | "lease_lost"> {
    const handler = this.handlers.get(event.eventType);
    if (!handler) return "lease_lost";

    const controller = new AbortController();
    this.active.add(controller);
    let leaseLost = false;
    let renewal: Promise<void> | null = null;
    const heartbeatMs = Math.max(100, Math.floor(this.options.leaseMs / 3));
    const heartbeat = setInterval(() => {
      if (renewal || controller.signal.aborted) return;
      renewal = this.repository.extendLease(
        event.id,
        event.attempts,
        new Date(this.now().getTime() + this.options.leaseMs),
      ).then((extended) => {
        if (!extended) {
          leaseLost = true;
          controller.abort();
        }
      }).catch(() => {
        leaseLost = true;
        controller.abort();
      }).finally(() => {
        renewal = null;
      });
    }, heartbeatMs);
    heartbeat.unref();
    const stopHeartbeat = async (): Promise<void> => {
      clearInterval(heartbeat);
      await renewal?.catch(() => undefined);
    };

    try {
      await handler(event, { signal: controller.signal });
      await stopHeartbeat();
      if (leaseLost || controller.signal.aborted) {
        throw new RetryableWorkerError(leaseLost ? "lease_lost" : "shutdown_aborted");
      }
      const processed = await this.repository.markProcessed(event.id, event.attempts, this.now());
      if (!processed) {
        this.logger.warn({
          eventId: event.id,
          eventType: event.eventType,
          attempt: event.attempts,
          errorCode: "lease_lost",
        }, "worker_event_fence_rejected");
        return "lease_lost";
      }
      return "processed";
    } catch (error) {
      await stopHeartbeat();
      if (leaseLost) return "lease_lost";
      if (error instanceof DeferredWorkerError) {
        const rescheduled = await this.repository.reschedule(
          event.id,
          event.attempts,
          error.availableAt,
        );
        this.logger.warn({
          eventId: event.id,
          eventType: event.eventType,
          attempt: event.attempts,
          errorCode: error.code,
          retried: rescheduled ? 1 : 0,
        }, "worker_event_retry_scheduled");
        return rescheduled ? "retried" : "lease_lost";
      }
      const invalid = error instanceof InvalidEventError;
      const finalAttempt = event.attempts >= this.options.maxAttempts;
      const errorCode = safeErrorCode(error);
      if (invalid || finalAttempt) {
        const deadLettered = await this.repository.deadLetter(
          event.id,
          event.attempts,
          this.options.maxAttempts,
          this.now(),
        );
        if (deadLettered && event.eventType === "billing.reconciliation_requested.v1") {
          await this.repository.failBillingReconciliationItem(event.id, errorCode, this.now());
        }
        this.logger.error({
          eventId: event.id,
          eventType: event.eventType,
          attempt: event.attempts,
          errorCode,
          deadLettered: deadLettered ? 1 : 0,
        }, "worker_event_dead_lettered");
        return deadLettered ? "dead_lettered" : "lease_lost";
      }

      const delay = deterministicBackoffMs({
        eventId: event.id,
        attempt: event.attempts,
        baseMs: this.options.backoffBaseMs,
        maxMs: this.options.backoffMaxMs,
        jitterRatio: this.options.backoffJitterRatio,
      });
      const retried = await this.repository.reschedule(
        event.id,
        event.attempts,
        new Date(this.now().getTime() + delay),
      );
      this.logger.warn({
        eventId: event.id,
        eventType: event.eventType,
        attempt: event.attempts,
        errorCode,
        retried: retried ? 1 : 0,
      }, "worker_event_retry_scheduled");
      return retried ? "retried" : "lease_lost";
    } finally {
      await stopHeartbeat();
      this.active.delete(controller);
    }
  }
}
