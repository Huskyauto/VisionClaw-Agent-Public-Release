// R110.11.6 +sec — Auth bypass probe detector.
//
// Inspired by `devploit/nomore403` (offensive 403/401 bypass scanner). Express
// + Helmet already ignore the bypass tricks correctly (it's the *correct*
// behavior), but we never SAW that someone was trying — they got a normal
// 401/403 indistinguishable from a regular auth fail. This middleware adds
// the missing telemetry: detect known bypass signatures on incoming requests
// and emit a loud structured log line so the deployment log scanner picks
// them up.
//
// HARD RULE: Never blocks. Real auth still runs and still 401/403s these
// requests. We only LOG. A buggy detector pattern must never turn a
// legitimate request into a 4xx.
//
// Pure detector function exported for unit testing without booting Express.

import type { Request, Response, NextFunction } from "express";

/** Headers that name-spoof the request URL (Apache mod_rewrite tricks). */
const URL_REWRITE_HEADERS = [
  "x-original-url",
  "x-rewrite-url",
  "x-override-url",
  "x-forwarded-uri",
  "x-forwarded-path",
] as const;

/** Headers that name-spoof method (POST→GET style override). */
const METHOD_OVERRIDE_HEADERS = [
  "x-http-method",
  "x-http-method-override",
  "x-method-override",
] as const;

/** Headers carrying an IP value — flagged when value claims localhost. */
const IP_SPOOF_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "x-remote-ip",
  "x-originating-ip",
  "x-remote-addr",
  "client-ip",
  "true-client-ip",
] as const;

/** Hostname headers — flagged when value claims localhost / 127.x. */
const HOST_SPOOF_HEADERS = [
  "x-forwarded-host",
  "x-host",
  "x-forwarded-server",
] as const;

// Architect findings R110.11.6 (LOW × 2 closed same-round):
//   (a) trailing `\b` matched `127.0.0.1.com` → swapped to negative lookahead
//       `(?![\w.-])` so any extension keeps the value out.
//   (b) added 172.16.0.0/12 private range (16-31 in 2nd octet).
const LOCALHOST_VALUE_RE = /(?:^|[\s,])(?:127\.\d+\.\d+\.\d+|::1|localhost|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2[0-9]|3[01])\.\d+\.\d+)(?![\w.-])/i;

/**
 * Path-mutation tricks that trailing-slash-tolerant proxies/Apache historically
 * mishandled (e.g. `/admin/.` or `/admin..;/` slipping past a regex auth rule
 * but resolving to `/admin/` at the application). Only flagged on sensitive
 * URL prefixes — bare `..` or trailing dot on `/uploads/...` is normal.
 */
const PATH_MUTATION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "semicolon-segment", re: /\/[^\/?#]*;/ },        // /admin;/x
  { name: "double-dot-semi", re: /\.\.;/ },                 // /admin..;/
  { name: "encoded-traversal", re: /%2[eE]%2[eE]|%2[eE]\/|\/%2[eE]/ }, // %2e%2e
  { name: "trailing-dot", re: /\/[^\/?#]+\.(?:[?#]|$)/ },   // /admin.
  { name: "double-slash", re: /\/\/+(?!$)/ },                // /admin//users
  { name: "encoded-slash", re: /%2[fF]/ },                   // %2f
];

const SENSITIVE_PATH_RE = /^\/api\/(?:admin|tools\/(?:exec_sql|shell_exec|run_command|reveal_secret|rotate_secret|delete_persona|delete_tenant|delete_custom_tool|bulk_delete|run_ab_eval|send_bulk_email|undo_last_action|query_trace|system_load_status|slash_command)|debug|internal)\b/i;

export interface BypassProbeResult {
  detected: boolean;
  signals: string[];
  /** True when one of the signals is on a sensitive admin/trusted path. */
  sensitive: boolean;
}

/**
 * Pure function: inspect a Request-shaped object and return what (if anything)
 * looks like a 403/401 bypass attempt. Multiple signals are concatenated.
 *
 * The req parameter only needs `headers` (object), `method` (string) and one
 * of `originalUrl` / `url` / `path` (string). Tests pass plain objects.
 */
export function detectAuthBypassProbe(req: {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
}): BypassProbeResult {
  const signals: string[] = [];
  const headers = req.headers || {};
  const url = req.originalUrl || req.url || req.path || "";
  const sensitive = SENSITIVE_PATH_RE.test(url);

  // 1. URL-rewrite headers (any presence = probe; no legitimate browser sends these)
  for (const name of URL_REWRITE_HEADERS) {
    if (headers[name] !== undefined) signals.push(`url-rewrite:${name}`);
  }

  // 2. Method override headers (any presence = probe)
  for (const name of METHOD_OVERRIDE_HEADERS) {
    if (headers[name] !== undefined) signals.push(`method-override:${name}`);
  }

  // 3. IP-spoofing: header present AND value contains a localhost-class address.
  //    XFF in production is normal (set by the Replit edge proxy); we only flag
  //    when the value is the localhost/private trick used by nomore403.
  for (const name of IP_SPOOF_HEADERS) {
    const v = headers[name];
    if (!v) continue;
    const value = Array.isArray(v) ? v.join(",") : String(v);
    if (LOCALHOST_VALUE_RE.test(value)) signals.push(`ip-spoof:${name}=${value.slice(0, 60)}`);
  }

  // 4. Host-spoofing: same shape as IP spoofing but on Host-class headers.
  for (const name of HOST_SPOOF_HEADERS) {
    const v = headers[name];
    if (!v) continue;
    const value = Array.isArray(v) ? v.join(",") : String(v);
    if (LOCALHOST_VALUE_RE.test(value)) signals.push(`host-spoof:${name}=${value.slice(0, 60)}`);
  }

  // 5. Path mutations — only flag on sensitive URL prefixes to keep noise
  //    floor low. /uploads/.. and other public surfaces hit these patterns
  //    legitimately (browser cache busting, etc).
  if (sensitive) {
    for (const { name, re } of PATH_MUTATION_PATTERNS) {
      if (re.test(url)) signals.push(`path-mutation:${name}`);
    }
  }

  return { detected: signals.length > 0, signals, sensitive };
}

/**
 * In-memory counter for ops dashboards. Not persisted (a process restart
 * resets to 0 — that's fine; this is volume-trend telemetry, not forensics).
 */
let probeCount = 0;
let probeSensitiveCount = 0;
export function getAuthBypassProbeCounts(): { total: number; sensitive: number } {
  return { total: probeCount, sensitive: probeSensitiveCount };
}
export function _resetAuthBypassProbeCountsForTests(): void {
  probeCount = 0;
  probeSensitiveCount = 0;
}

/**
 * Express middleware. Detects + logs + counts. NEVER short-circuits the
 * pipeline; downstream auth still runs and still 401/403s legitimately.
 */
export function authBypassProbeMiddleware() {
  return function authBypassProbeMw(req: Request, _res: Response, next: NextFunction) {
    try {
      const result = detectAuthBypassProbe(req);
      if (result.detected) {
        probeCount++;
        if (result.sensitive) probeSensitiveCount++;
        // Loud structured log — picked up by deployment log scanner + decline-events
        // sweep tooling. Tag prefix `[security] auth_bypass_probe` is grep-able.
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || (req as any).ip || "?";
        const ua = String(req.headers["user-agent"] || "?").slice(0, 80).replace(/[\r\n]/g, " ");
        const url = (req.originalUrl || req.url || "").slice(0, 200).replace(/[\r\n]/g, "");
        console.warn(
          `[security] auth_bypass_probe sensitive=${result.sensitive} method=${req.method} path=${url} ip=${ip} ua="${ua}" signals=[${result.signals.join(",")}]`,
        );
        (req as any)._bypassProbeFlag = true;
        (req as any)._bypassProbeSignals = result.signals;
      }
    } catch (err: any) {
      // FAIL-OPEN: a buggy detector must never break the request pipeline.
      // We DO want to know it failed though.
      console.warn(`[security] auth_bypass_probe DETECTOR_ERROR: ${err?.message || err}`);
    }
    next();
  };
}
