export class RetryableWorkerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RetryableWorkerError";
    this.code = code;
  }
}

export class InvalidEventError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "InvalidEventError";
    this.code = code;
  }
}

export class DeferredWorkerError extends Error {
  readonly code: string;
  readonly availableAt: Date;

  constructor(code: string, availableAt: Date) {
    super(code);
    if (Number.isNaN(availableAt.getTime())) throw new Error("deferred_available_at_invalid");
    this.name = "DeferredWorkerError";
    this.code = code;
    this.availableAt = new Date(availableAt);
  }
}

export function safeErrorCode(error: unknown): string {
  if (
    error instanceof RetryableWorkerError
    || error instanceof InvalidEventError
    || error instanceof DeferredWorkerError
  ) {
    return error.code;
  }
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "unhandled_error";
}
