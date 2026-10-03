// R125+13.8+sec (architect HIGH closed): shared per-IP PIN brute-force
// throttle, extracted from server/routes/gmail-direct.ts so other PIN-gated
// public-prefix admin endpoints (e.g. /api/admin/leads/audit) can reuse the
// same lockout primitive instead of re-implementing it (or worse — shipping
// without throttle).
//
// Policy: PIN_ATTEMPT_LIMIT failed attempts per PIN_ATTEMPT_WINDOW_MS per
// source IP. On exceed, return 429 for PIN_LOCKOUT_MS regardless of
// subsequent PIN correctness. Successful PIN entry clears the bucket for
// that IP. In-memory by design (single-instance Replit, clears on restart).
import type { Request } from "express";

const PIN_ATTEMPT_WINDOW_MS = 10 * 60_000;
const PIN_ATTEMPT_LIMIT = 8;
const PIN_LOCKOUT_MS = 30 * 60_000;
const PIN_BUCKET_MAX = 5000;

type Bucket = { count: number; resetAt: number; lockedUntil: number };
const BUCKETS = new Map<string, Bucket>();

function ipKey(req: Request): string {
  // trust proxy=1 is set globally, so req.ip is the real client IP.
  return req.ip || "unknown";
}

export function pinThrottleCheck(req: Request): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  if (BUCKETS.size >= PIN_BUCKET_MAX) {
    for (const [k, v] of BUCKETS.entries()) {
      if (v.resetAt < now && v.lockedUntil < now) BUCKETS.delete(k);
    }
    // If pruning expired entries wasn't enough, evict in insertion order until
    // we're back under the cap. Map iteration order is insertion order, so this
    // is effectively oldest-first FIFO eviction (architect MEDIUM closed).
    while (BUCKETS.size >= PIN_BUCKET_MAX) {
      const oldest = BUCKETS.keys().next().value;
      if (!oldest) break;
      BUCKETS.delete(oldest);
    }
  }
  const key = ipKey(req);
  const bucket = BUCKETS.get(key);
  if (!bucket) return { ok: true };
  if (bucket.lockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.lockedUntil - now) / 1000) };
  }
  if (bucket.resetAt < now) {
    BUCKETS.delete(key);
    return { ok: true };
  }
  return { ok: true };
}

export function pinThrottleRecord(req: Request, success: boolean): void {
  const key = ipKey(req);
  if (success) {
    BUCKETS.delete(key);
    return;
  }
  const now = Date.now();
  const existing = BUCKETS.get(key);
  if (!existing || existing.resetAt < now) {
    BUCKETS.set(key, { count: 1, resetAt: now + PIN_ATTEMPT_WINDOW_MS, lockedUntil: 0 });
    return;
  }
  existing.count += 1;
  if (existing.count >= PIN_ATTEMPT_LIMIT) {
    existing.lockedUntil = now + PIN_LOCKOUT_MS;
  }
}
