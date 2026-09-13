export const DEFAULT_READINESS_TIMEOUT_MS = 1_000;
export const DEFAULT_READINESS_CACHE_TTL_MS = 1_000;
export const MIN_READINESS_TIMEOUT_MS = 100;
export const MAX_READINESS_TIMEOUT_MS = 5_000;

export interface ReadinessTimer {
  set(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}

export interface ReadinessService {
  check(): Promise<boolean>;
  beginDrain(): void;
  isDraining(): boolean;
}

export interface ReadinessHttpResult {
  statusCode: 200 | 503;
  body: { status: "ready" | "not_ready" };
}

export interface CreateReadinessServiceOptions {
  checkDatabase: (signal: AbortSignal) => Promise<void>;
  timeoutMs: number;
  cacheTtlMs?: number;
  now?: () => number;
  timer?: ReadinessTimer;
}

export interface ReadinessDatabaseClient {
  query(config: {
    text: string;
    rowMode: "array";
  }): Promise<unknown>;
  release(destroy?: boolean): void;
}

export interface ReadinessDatabasePool {
  connect(): Promise<ReadinessDatabaseClient>;
}

class ReadinessTimeoutError extends Error {
  constructor() {
    super("Readiness check timed out");
    this.name = "ReadinessTimeoutError";
  }
}

const systemTimer: ReadinessTimer = {
  set(callback, timeoutMs) {
    return setTimeout(callback, timeoutMs);
  },
  clear(handle) {
    clearTimeout(handle);
  },
};

export function readReadinessTimeoutMs(
  rawValue = process.env.API_READINESS_TIMEOUT_MS,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_READINESS_TIMEOUT_MS;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error("API_READINESS_TIMEOUT_MS must be an integer in milliseconds");
  }

  const timeoutMs = Number(rawValue);
  if (timeoutMs < MIN_READINESS_TIMEOUT_MS || timeoutMs > MAX_READINESS_TIMEOUT_MS) {
    throw new Error(
      `API_READINESS_TIMEOUT_MS must be between ${MIN_READINESS_TIMEOUT_MS} and ${MAX_READINESS_TIMEOUT_MS}`,
    );
  }

  return timeoutMs;
}

export function readinessHttpResult(ready: boolean): ReadinessHttpResult {
  return ready
    ? { statusCode: 200, body: { status: "ready" } }
    : { statusCode: 503, body: { status: "not_ready" } };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timer: ReadinessTimer,
  onTimeout: () => void,
): Promise<T> {
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timerHandle = timer.set(() => {
      onTimeout();
      reject(new ReadinessTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timerHandle !== undefined) {
      timer.clear(timerHandle);
    }
  }
}

export function createPostgresReadinessCheck(
  databasePool: ReadinessDatabasePool,
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    // Pool acquisition is intentionally shared by ReadinessService. node-postgres
    // does not expose a supported way to remove one waiter from its FIFO queue,
    // so a timed-out acquisition remains the sole in-flight probe and cannot
    // grow an unbounded queue of health checks.
    const client = await databasePool.connect();
    let released = false;

    const release = (destroy: boolean) => {
      if (released) return;
      released = true;
      client.release(destroy);
    };

    const abort = () => {
      // A client-side Promise timeout alone does not cancel work already sent to
      // PostgreSQL. Destroying this checked-out connection interrupts the probe
      // and prevents a timed-out check from lingering in the shared pool.
      release(true);
    };

    if (signal.aborted) {
      release(false);
      throw new ReadinessTimeoutError();
    }

    signal.addEventListener("abort", abort, { once: true });
    try {
      await client.query({ text: "SELECT 1", rowMode: "array" });
    } finally {
      signal.removeEventListener("abort", abort);
      release(false);
    }
  };
}

export function createReadinessService(
  options: CreateReadinessServiceOptions,
): ReadinessService {
  const timer = options.timer ?? systemTimer;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_READINESS_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) {
    throw new Error("readiness cacheTtlMs must be a non-negative finite number");
  }
  let draining = false;
  let cachedResult: { ready: boolean; expiresAt: number } | undefined;
  let databaseCheckInFlight:
    | { promise: Promise<void>; abortController: AbortController }
    | undefined;

  function databaseCheck(): {
    promise: Promise<void>;
    abortController: AbortController;
  } {
    if (databaseCheckInFlight) return databaseCheckInFlight;

    const abortController = new AbortController();
    const promise = Promise.resolve().then(() =>
      options.checkDatabase(abortController.signal),
    );
    const current = { promise, abortController };
    databaseCheckInFlight = current;

    // Keep a rejection handler attached even when the HTTP timeout wins the race.
    void promise.then(
      () => {
        if (databaseCheckInFlight === current) databaseCheckInFlight = undefined;
      },
      () => {
        if (databaseCheckInFlight === current) databaseCheckInFlight = undefined;
      },
    );

    return current;
  }

  return {
    async check() {
      if (draining) return false;

      const currentTime = now();
      if (cachedResult && currentTime < cachedResult.expiresAt) {
        return cachedResult.ready;
      }

      try {
        const current = databaseCheck();
        await withTimeout(
          current.promise,
          options.timeoutMs,
          timer,
          () => current.abortController.abort(),
        );
        const ready = !draining;
        if (!draining) {
          cachedResult = { ready, expiresAt: now() + cacheTtlMs };
        }
        return ready;
      } catch {
        if (!draining) {
          cachedResult = { ready: false, expiresAt: now() + cacheTtlMs };
        }
        return false;
      }
    },
    beginDrain() {
      draining = true;
      cachedResult = undefined;
      databaseCheckInFlight?.abortController.abort();
    },
    isDraining() {
      return draining;
    },
  };
}
