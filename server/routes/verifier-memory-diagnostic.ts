import { type Express, type Request, type RequestHandler, type Response } from "express";
import { readVerifierMemoryDiagnostic, type VerifierMemoryDiagnostic } from "../lib/verifier-memory-source";

type Diagnostic = VerifierMemoryDiagnostic;

type Helpers = {
  authMiddleware: RequestHandler;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  adminTenantId: number;
  readDiagnostic?: () => Diagnostic;
};

const safeStates = new Set([
  "available", "missing", "unresolved", "unbounded", "finite", "invalid",
  "invalid_or_unbounded", "read_error", "unavailable", "ambiguous",
]);
const safeReasons = new Set([
  "available", "unavailable", "no-authoritative-limit", "cgroup-unresolved",
  "cgroup-read-failed", "invalid-snapshot",
]);

function safeDiagnostic(value: Diagnostic): Diagnostic {
  const numberOrZero = (number: number) =>
    Number.isSafeInteger(number) && number >= 0 ? number : 0;
  const snapshot = value.snapshot
    && Number.isSafeInteger(value.snapshot.maxBytes) && value.snapshot.maxBytes > 0
    && Number.isSafeInteger(value.snapshot.currentBytes) && value.snapshot.currentBytes >= 0
    ? { maxBytes: value.snapshot.maxBytes, currentBytes: Math.min(value.snapshot.currentBytes, value.snapshot.maxBytes) }
    : null;
  const inspect = (item: Diagnostic["v2"]) => ({
    mounts: numberOrZero(item.mounts),
    resolved: item.resolved === true,
    state: safeStates.has(item.state) ? item.state : "unavailable",
  });
  const source = value.source === "cgroup-v2" || value.source === "cgroup-v1" ? value.source : null;
  const available = value.available === true && !!snapshot && !!source;
  return {
    available,
    source: available ? source : null,
    snapshot: available ? snapshot : null,
    reason: available ? "available" : safeReasons.has(value.reason) && value.reason !== "available"
      ? value.reason : "no-authoritative-limit",
    v2: inspect(value.v2),
    v1: inspect(value.v1),
  };
}

export function registerVerifierMemoryDiagnosticRoute(app: Express, helpers: Helpers) {
  let cachedAt = 0;
  let cached: Diagnostic | null = null;
  let windowStartedAt = Date.now();
  let authorizedRequestsInWindow = 0;
  app.get(
    "/api/admin/diagnostics/verifier-memory",
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    helpers.authMiddleware,
    async (req: Request, res: Response) => {
      if (helpers.getTenantFromRequest(req) !== helpers.adminTenantId || !helpers.isAdminRequest(req)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const now = Date.now();
      if (now < windowStartedAt || now - windowStartedAt >= 60_000) {
        windowStartedAt = now;
        authorizedRequestsInWindow = 0;
      }
      if (authorizedRequestsInWindow >= 10) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((60_000 - (now - windowStartedAt)) / 1000))));
        return res.status(429).json({ error: "Verifier memory diagnostic rate limit exceeded" });
      }
      authorizedRequestsInWindow++;
      try {
        if (!cached || now - cachedAt >= 2_000) {
          const read = helpers.readDiagnostic ?? readVerifierMemoryDiagnostic;
          cached = safeDiagnostic(read());
          cachedAt = now;
        }
        return res.json(cached);
      } catch {
        return res.status(500).json({ error: "Verifier memory diagnostic unavailable" });
      }
    },
  );
}