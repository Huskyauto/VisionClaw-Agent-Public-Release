/**
 * server/lib/self-health.ts — Bob 2026-06-03
 *
 * First-class self-health primitives so an agent asked to "test all the systems"
 * can confirm THIS app's own web server is reachable WITHOUT improvising
 * localhost probes through the browser / exec / execute_code tools (all of which
 * are correctly blocked by SSRF / owner-only / sandbox guards — the agent
 * previously burned several rounds on those dead-ends, then gave up with an
 * empty deliverable).
 *
 * `probeWebServer` runs an in-process loopback fetch. The target is FIXED to
 * 127.0.0.1:PORT — it is never agent/user-controlled — and it runs server-side
 * (not through the browser tool's navigation path), so it does NOT relax the
 * SSRF posture. Any HTTP response proves the server is serving; only a
 * connection failure or timeout counts as down.
 *
 * `isLoopbackUrl` detects internal/loopback addresses so the browser tool can
 * redirect a blocked self-probe to `check_system_status` instead of dead-ending.
 */

export type WebServerHealth = {
  reachable: boolean;
  httpStatus?: number;
  responseMs: number;
  port: number;
  error?: string;
};

// Matches localhost, the whole 127.0.0.0/8 loopback block, 0.0.0.0, IPv6 ::1
// (bracketed or bare), and the IPv4-mapped-IPv6 loopback ::ffff:127.x.x.x.
const LOOPBACK_RE =
  /(^|\/\/)(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|\[?::ffff:127(?:\.\d{1,3}){3}\]?)(:|\/|$)/i;

export function isLoopbackUrl(url: string): boolean {
  return LOOPBACK_RE.test(String(url || ""));
}

export async function probeWebServer(
  port: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<WebServerHealth> {
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(`http://127.0.0.1:${port}/`, { signal: ac.signal, redirect: "manual" });
    return { reachable: true, httpStatus: resp.status, responseMs: Date.now() - startedAt, port };
  } catch (e: any) {
    return {
      reachable: false,
      error: e?.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e?.message || String(e),
      responseMs: Date.now() - startedAt,
      port,
    };
  } finally {
    clearTimeout(timer);
  }
}
