import { createServer, type Server } from "node:http";
import type { SafeLogger, SupportedEventType, WorkerRepository } from "./types.ts";

function json(
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export class HealthServer {
  private readonly server: Server;
  private readonly repository: WorkerRepository;
  private readonly maxAttempts: number;
  private readonly eventTypes: readonly SupportedEventType[];
  private readonly isShuttingDown: () => boolean;
  private readonly logger: SafeLogger;

  constructor(
    repository: WorkerRepository,
    maxAttempts: number,
    eventTypes: readonly SupportedEventType[],
    isShuttingDown: () => boolean,
    logger: SafeLogger,
  ) {
    this.repository = repository;
    this.maxAttempts = maxAttempts;
    this.eventTypes = eventTypes;
    this.isShuttingDown = isShuttingDown;
    this.logger = logger;
    this.server = createServer((request, response) => {
      void this.respond(request.url ?? "", response);
    });
  }

  async listen(port: number): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, "0.0.0.0");
    });
    const address = this.server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;
    this.logger.info({ port: boundPort, status: "listening" }, "worker_health_started");
    return boundPort;
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  private async respond(
    url: string,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    const path = url.split("?", 1)[0];
    if (path === "/health/live") {
      json(response, 200, { status: "live" });
      return;
    }
    if (path !== "/health" && path !== "/health/ready") {
      json(response, 404, { status: "not_found" });
      return;
    }
    if (this.isShuttingDown()) {
      json(response, 503, { status: "shutting_down" });
      return;
    }
    try {
      await this.repository.ping();
      const deadLettered = await this.repository.deadLetterCount(this.maxAttempts, this.eventTypes);
      json(response, 200, {
        status: deadLettered > 0 ? "degraded" : "ready",
        deadLettered,
      });
    } catch {
      json(response, 503, { status: "unavailable" });
    }
  }
}
