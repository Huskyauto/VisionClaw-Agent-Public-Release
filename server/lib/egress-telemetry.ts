/**
 * Egress telemetry ring buffer (OpenClaw proxy-capture borrow, lightweight
 * native shape — R125+137.22).
 *
 * Records every outbound HTTP call made through the platform's bounded
 * fetch chokepoints (fetchWithTimeout, ssrf-jail) into a fixed-size
 * in-memory ring: host (never full URL — query strings can carry tokens),
 * method, status, duration, outcome. Surfaced via check_system_status so an
 * operator can see WHERE the platform talks and what's failing, without a
 * schema migration or an MITM proxy.
 *
 * Fail-OPEN observability: recording must never break a fetch. Record-only
 * — this module must never become a gate.
 */

import { logSilentCatch } from "./silent-catch";

export interface EgressRecord {
  at: number;
  host: string;
  method: string;
  status: number | null;
  ms: number;
  outcome: "ok" | "http_error" | "timeout" | "aborted" | "network_error" | "blocked";
  source: string;
}

const RING_MAX = 500;
const ring: EgressRecord[] = [];
let dropped = 0;

export function recordEgress(rec: Omit<EgressRecord, "at">): void {
  try {
    ring.push({ at: Date.now(), ...rec, host: String(rec.host || "unknown").slice(0, 200) });
    if (ring.length > RING_MAX) { ring.shift(); dropped++; }
  } catch (_silentErr) { logSilentCatch("server/lib/egress-telemetry.ts", _silentErr); }
}

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return "unparseable"; }
}

export interface EgressSummary {
  windowStart: number | null;
  total: number;
  droppedBeforeWindow: number;
  byHost: Array<{ host: string; count: number; errors: number; timeouts: number; avgMs: number }>;
  recentFailures: Array<{ at: number; host: string; method: string; outcome: string; status: number | null }>;
}

export function summarizeEgress(limitHosts = 15): EgressSummary {
  const byHost = new Map<string, { count: number; errors: number; timeouts: number; totalMs: number }>();
  for (const r of ring) {
    const e = byHost.get(r.host) || { count: 0, errors: 0, timeouts: 0, totalMs: 0 };
    e.count++;
    e.totalMs += r.ms;
    if (r.outcome === "timeout") e.timeouts++;
    else if (r.outcome !== "ok" && r.outcome !== "aborted") e.errors++;
    byHost.set(r.host, e);
  }
  return {
    windowStart: ring.length ? ring[0].at : null,
    total: ring.length,
    droppedBeforeWindow: dropped,
    byHost: [...byHost.entries()]
      .map(([host, e]) => ({ host, count: e.count, errors: e.errors, timeouts: e.timeouts, avgMs: Math.round(e.totalMs / e.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limitHosts),
    recentFailures: ring.filter(r => r.outcome !== "ok" && r.outcome !== "aborted").slice(-10)
      .map(r => ({ at: r.at, host: r.host, method: r.method, outcome: r.outcome, status: r.status })),
  };
}

/** Test-only reset. */
export function _resetEgressRing(): void { ring.length = 0; dropped = 0; }
