/**
 * Tools-layer-split S9 — SSRF / safe-fetch cluster, extracted VERBATIM from
 * server/tools.ts as ONE module per the helper census rule (helper-census.md
 * § "SSRF / safe-fetch cluster"): `ipv4MappedToV4`, `isPrivateIp`,
 * `isUrlSafeSync`, `isUrlSafe`, `safeFetchFollowRedirects` form one
 * security-sensitive unit consumed by `webFetch`, `webSearch`, and scattered
 * handler arms. Never split across files.
 *
 * NOTE: overlaps `server/lib/ssrf-jail.ts` conceptually but is a SEPARATE
 * implementation — do NOT merge them during the split (no behavior change
 * rule); the dedup is a logged post-S25 follow-up.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { isIP as _netIsIP } from "node:net";

// Package acyclicity invariant (plan.md S2): no static imports outside
// server/tools/. isUrlSafeSync is SYNC, so the silent-catch logger is loaded
// fire-and-forget; the catch it serves (net.isIP throwing) is a
// never-in-practice branch and the fail-closed treatment does not depend on
// the log landing.
function logSilentCatchAsync(site: string, err: unknown): void {
  void import("../../lib/silent-catch")
    .then((m) => m.logSilentCatch(site, err))
    .catch(() => {});
}

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "::1", "metadata.google.internal"]);

// R110 +sec gold-pass-5 — extract IPv4 from any IPv4-mapped IPv6 form.
// Node's URL parser canonicalizes `[::ffff:127.0.0.1]` to host
// `::ffff:7f00:1` (hex), so we MUST decode the last 32 bits, not just
// pattern-match the dotted-decimal form. Returns null if it can't be
// decoded; caller treats null as private (fail-closed).
function ipv4MappedToV4(lower: string): string | null {
  if (!lower.startsWith("::ffff:") && !lower.startsWith("::")) return null;
  const tail = lower.replace(/^::(ffff:)?/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return tail;
  const groups = lower.split(":").filter((g) => g.length > 0);
  if (groups.length >= 2) {
    const g1 = groups[groups.length - 2];
    const g2 = groups[groups.length - 1];
    if (/^[0-9a-f]{1,4}$/.test(g1) && /^[0-9a-f]{1,4}$/.test(g2)) {
      const hex = g1.padStart(4, "0") + g2.padStart(4, "0");
      const a = parseInt(hex.slice(0, 2), 16);
      const b = parseInt(hex.slice(2, 4), 16);
      const c = parseInt(hex.slice(4, 6), 16);
      const d = parseInt(hex.slice(6, 8), 16);
      return `${a}.${b}.${c}.${d}`;
    }
  }
  return null;
}

export function isPrivateIp(ip: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;        // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                       // multicast / reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(lower)) return true;                          // link-local fe80::/10 (fe80–febf)
  if (lower.startsWith("ff")) return true;                            // multicast ff00::/8
  // R110 +sec gold-pass-5 — IPv4-mapped IPv6, both decimal-dotted form
  // (`::ffff:127.0.0.1`) and Node-canonicalized hex form (`::ffff:7f00:1`).
  // Fail CLOSED: any `::ffff:` prefix we cannot decode is treated as private.
  if (lower.startsWith("::ffff:")) {
    const v4 = ipv4MappedToV4(lower);
    if (v4 === null) return true;
    return isPrivateIp(v4);
  }
  return false;
}

export function isUrlSafeSync(urlStr: string): { safe: boolean; error?: string; host?: string; isLiteralIp?: boolean } {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return { safe: false, error: "Only http/https URLs allowed" };
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (BLOCKED_HOSTS.has(host)) return { safe: false, error: "Blocked host" };
    if (host.endsWith(".local") || host.endsWith(".internal")) return { safe: false, error: "Internal hostname blocked" };
    // R110 +sec gold-pass-4: route ALL literal IPs (v4 + v6) through the
    // canonical isPrivateIp check rather than the partial v4-only regex
    // that used to live here. Plugs ::1, fc00::/7 ULA, fe80::/10
    // link-local, ::ffff: IPv4-mapped, and 100.64/10 CGNAT bypasses.
    // R110.21.1 (architect MEDIUM): was bare `require("net")` which throws
    // "require is not defined" under tsx/ESM runtime — caught silently by the
    // outer try/catch but degraded SSRF protection (literal-IP check skipped).
    // Now uses Node's stable global `URL` parser side-step: net.isIP via
    // top-level static import (see imports above).
    let isLiteralIp = false;
    try {
      isLiteralIp = _netIsIP(host) !== 0;
    } catch (_e) { logSilentCatchAsync("server/tools/lib/safe-fetch.ts", _e); }
    if (isLiteralIp) {
      if (isPrivateIp(host)) return { safe: false, error: `Literal IP ${host} is in a private/loopback/metadata range` };
      return { safe: true, host, isLiteralIp: true };
    }
    return { safe: true, host, isLiteralIp: false };
  } catch {
    return { safe: false, error: "Invalid URL" };
  }
}

// R110 +sec gold-pass-3/4 — Async SSRF guard with DNS re-validation. The
// hostname-only check above is bypassable by attacker-controlled DNS
// records that resolve a public hostname to 169.254.169.254 (AWS
// metadata) or to 10.x/192.168.x. We resolve all A/AAAA records and
// reject if ANY address falls in a private/loopback/metadata range.
// Literal IPs are already validated by isUrlSafeSync via isPrivateIp.
export async function isUrlSafe(urlStr: string): Promise<{ safe: boolean; error?: string }> {
  const sync = isUrlSafeSync(urlStr);
  if (!sync.safe) return sync;
  if (sync.isLiteralIp) return { safe: true };
  const host = sync.host!;
  try {
    const dns = await import("dns");
    const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return { safe: false, error: `Host ${host} resolves to private/loopback/metadata IP ${a.address}` };
      }
    }
    return { safe: true };
  } catch (err: any) {
    return { safe: false, error: `DNS resolution failed for ${host}: ${String(err?.message || err).slice(0, 100)}` };
  }
}

// R116.2 — SSRF-safe redirect follower. `redirect: "follow"` lets a public URL
// 30x into an internal target after the pre-fetch SSRF guard already cleared
// it. This helper re-runs `isUrlSafe` on every Location header (max 5 hops)
// and returns the final Response, or throws if any hop is unsafe.
export async function safeFetchFollowRedirects(
  startUrl: string,
  init: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = startUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const resp = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (resp.status < 300 || resp.status >= 400 || !resp.headers.get("location")) {
      return resp;
    }
    if (i === maxRedirects) throw new Error(`Too many redirects (>${maxRedirects})`);
    const loc = resp.headers.get("location")!;
    const nextUrl = new URL(loc, currentUrl).toString();
    const hopCheck = await isUrlSafe(nextUrl);
    if (!hopCheck.safe) throw new Error(`Unsafe redirect to ${nextUrl}: ${hopCheck.error}`);
    currentUrl = nextUrl;
  }
  throw new Error("Redirect loop terminated unexpectedly");
}
