import type { NextFunction, Request, RequestHandler, Response } from "express";
import { HttpError } from "../lib/http.ts";

type Bucket = { count: number; resetAt: number };

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  maxKeys?: number;
  key?: (req: Request) => string;
};

const DEFAULT_MAX_KEYS = 10_000;

function validPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function evictOldest(buckets: Map<string, Bucket>, maxKeys: number, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size >= maxKeys) {
    const oldest = buckets.keys().next().value;
    if (typeof oldest !== "string") break;
    buckets.delete(oldest);
  }
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const windowMs = validPositiveInteger(options.windowMs, "windowMs");
  const max = validPositiveInteger(options.max, "max");
  const maxKeys = validPositiveInteger(options.maxKeys ?? DEFAULT_MAX_KEYS, "maxKeys");
  const keyFor = options.key ?? ((req: Request) => req.ip || "unknown");
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFor(req).trim().slice(0, 256) || "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      evictOldest(buckets, maxKeys, now);
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("x-ratelimit-limit", String(max));
    res.setHeader("x-ratelimit-remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("retry-after", String(retryAfter));
      next(new HttpError(429, "Limite de requisições excedido", "Tente novamente após o intervalo informado.", "https://api.iaaprova.com.br/problems/rate-limit"));
      return;
    }
    next();
  };
}
