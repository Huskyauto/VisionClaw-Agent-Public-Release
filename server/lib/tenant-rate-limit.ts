// R102 — Per-tenant token-bucket rate limit for chat-style endpoints.
//
// In-memory bucket per tenant. Tokens refill linearly at `ratePerMin / 60` per
// second, capped at `burstCapacity`. Single-process — sufficient for the
// current single-instance deploy. Migrate to Redis when we shard.
//
// Returns { allowed, remaining, retryAfterSeconds }. Callers translate this
// into a 429 + headers when allowed=false.

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  capacity: number;
  ratePerMin: number;
}

const buckets = new Map<number, Bucket>();

function _envInt(raw: string | undefined, fallback: number, min = 1, max = 10_000): number {
  const v = parseInt(raw || "", 10);
  if (!Number.isFinite(v) || v < min || v > max) return fallback;
  return v;
}
const DEFAULT_RATE_PER_MIN = _envInt(process.env.CHAT_TENANT_RATE, 60);
const DEFAULT_BURST = _envInt(process.env.CHAT_TENANT_BURST, 20);

function refill(bucket: Bucket, now: number): void {
  const elapsedMs = Math.max(0, now - bucket.lastRefillMs);
  const refilled = (bucket.ratePerMin / 60_000) * elapsedMs;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refilled);
  bucket.lastRefillMs = now;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limitPerMin: number;
}

export function checkTenantRate(tenantId: number, opts?: { ratePerMin?: number; burst?: number }): RateLimitDecision {
  const ratePerMin = opts?.ratePerMin ?? DEFAULT_RATE_PER_MIN;
  const burst = opts?.burst ?? DEFAULT_BURST;
  const now = Date.now();
  let b = buckets.get(tenantId);
  if (!b) {
    b = { tokens: burst, lastRefillMs: now, capacity: burst, ratePerMin };
    buckets.set(tenantId, b);
  } else if (b.capacity !== burst || b.ratePerMin !== ratePerMin) {
    // Env / opts changed — re-anchor capacity but keep current tokens (clamped).
    b.capacity = burst;
    b.ratePerMin = ratePerMin;
    b.tokens = Math.min(b.tokens, burst);
  }
  refill(b, now);

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSeconds: 0, limitPerMin: ratePerMin };
  }
  // Out of tokens — compute when the next token will be available.
  const msUntilNext = ((1 - b.tokens) * 60_000) / ratePerMin;
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(msUntilNext / 1000)),
    limitPerMin: ratePerMin,
  };
}

/** For test cleanup. */
export function _resetTenantRate(tenantId?: number): void {
  if (tenantId === undefined) buckets.clear();
  else buckets.delete(tenantId);
}

/** Snapshot for system_load_status tool. */
export function tenantRateSnapshot(tenantId: number): { tokens: number; capacity: number; ratePerMin: number } | null {
  const b = buckets.get(tenantId);
  if (!b) return { tokens: DEFAULT_BURST, capacity: DEFAULT_BURST, ratePerMin: DEFAULT_RATE_PER_MIN };
  refill(b, Date.now());
  return { tokens: Math.floor(b.tokens), capacity: b.capacity, ratePerMin: b.ratePerMin };
}
