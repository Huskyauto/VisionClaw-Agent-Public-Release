import type { Request, Response, NextFunction } from "express";

type Options = {
  knownTenant(req: Request): number | null;
  sessionTenant(token: string): Promise<number | null>;
  now?: () => number;
  maxBuckets?: number;
};

/** Throttling only. Never stamps identity or replaces route authentication. */
export function createTenantRequestLimiter(options: Options) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const now = options.now || Date.now;
  const maxBuckets = options.maxBuckets ?? 10_000;
  const consume = (key: string, cap: number, res: Response): boolean => {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || time > bucket.resetAt) {
      if (!bucket && buckets.size >= maxBuckets) {
        for (const [key, entry] of buckets)
          if (time > entry.resetAt) buckets.delete(key);
        if (buckets.size >= maxBuckets) {
          res.status(429).json({ error: "Rate limiter saturated, please try again later" });
          return false;
        }
      }
      bucket = { count: 0, resetAt: time + 60_000 };
      buckets.set(key, bucket);
    }
    bucket.count++;
    res.setHeader("X-RateLimit-Limit", cap);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, cap - bucket.count));
    if (bucket.count > cap) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)));
      res.status(429).json({ error: "Too many requests, please try again later" });
      return false;
    }
    return true;
  };
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    let tenantId = options.knownTenant(req);
    const validTenant = (id: number | null) => Number.isSafeInteger(id) && id! > 0;
    if (!validTenant(tenantId)) tenantId = null;
    const token = typeof req.headers.authorization === "string"
      ? /^Bearer\s+([^\s]{1,256})$/i.exec(req.headers.authorization)?.[1] : undefined;
    if (!tenantId && token && !token.startsWith("vc_")) {
      // Bound identity lookups BEFORE touching Postgres. This is not auth:
      // protected routes still perform their complete authentication checks.
      if (!consume(`lookup-ip:${ip}`, 120, res)) return;
      try {
        const verified = await options.sessionTenant(token);
        tenantId = validTenant(verified) ? verified : null;
      } catch (error) {
        console.error("[request-rate-limit] Session lookup failed",
          error instanceof Error ? error.name : "UnknownError");
        res.status(503).json({ error: "Request session could not be verified. Try again later." });
        return;
      }
    }
    if (consume(tenantId ? `tid:${tenantId}` : `ip:${ip}`, tenantId ? 120 : 30, res)) next();
  };
}