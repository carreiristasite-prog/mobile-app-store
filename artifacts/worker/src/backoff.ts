import { createHash } from "node:crypto";

export interface BackoffOptions {
  eventId: string;
  attempt: number;
  baseMs: number;
  maxMs: number;
  jitterRatio: number;
}

function deterministicUnitInterval(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) / 0xffff_ffff;
}

export function deterministicBackoffMs(options: BackoffOptions): number {
  const exponent = Math.max(0, options.attempt - 1);
  const exponential = Math.min(options.maxMs, options.baseMs * (2 ** exponent));
  const unit = deterministicUnitInterval(`${options.eventId}:${options.attempt}`);
  const multiplier = 1 + ((unit * 2) - 1) * options.jitterRatio;
  return Math.max(0, Math.min(options.maxMs, Math.round(exponential * multiplier)));
}

