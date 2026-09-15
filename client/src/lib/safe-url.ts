// R125+1 — shared protocol allow-list for external CTAs.
// Mirrors the helper inlined in video-jobs-banner.tsx (R124 architect MEDIUM fix).
// Accepts site-relative paths and http(s) only; rejects javascript:, data:,
// vbscript:, blob:, file:, etc. Returns undefined when the URL is unsafe so the
// caller can conditionally render the anchor.
//
// R125+12+sec (architect MEDIUM closed 2026-05-24): also blocks localhost,
// RFC1918 private ranges, link-local, and IPv6-internal hosts so a tainted
// DB-sourced URL can't render an anchor pointing at the customer's own
// intranet / 169.254 metadata services / IPv6 loopback. Defense-in-depth —
// server-side host allowlists remain the primary control.
// R125+13.3+sec (architect MEDIUM closed 2026-05-24): hostname is normalized
// before pattern matching — lowercased, trailing dot stripped (`localhost.`
// → `localhost`), surrounding square brackets stripped (`[::1]` → `::1`).
// IPv4-mapped IPv6 in BOTH dotted form (`::ffff:127.0.0.1`) AND Node-canonical
// hex form (`::ffff:7f00:1`) routed through the loopback/private check.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
  /^::1$/,
  // R125+13.8+sec (architect MEDIUM closed): also accept compressed ULA
  // forms — `fc::1`, `fd::1`, `fc:abcd::1`, etc. Previous regex only
  // matched fully-written `fcXX:`/`fdXX:` octets.
  /^fc[0-9a-f]{0,2}:/i,
  /^fd[0-9a-f]{0,2}:/i,
  /^fe[89ab][0-9a-f]?:/i, // fe80::/10 link-local incl. compressed
  /^fe80:/i,
  /^::ffff:/i, // any IPv4-mapped IPv6 (hex or dotted form)
  /^0:0:0:0:0:ffff:/i,
];

function normalizeHost(raw: string): string {
  let h = raw.toLowerCase().trim();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

export function safeUrl(u?: string | null): string | undefined {
  if (!u || typeof u !== "string") return undefined;
  const t = u.trim();
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  try {
    const parsed = new URL(t);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    const host = normalizeHost(parsed.hostname);
    if (!host) return undefined;
    for (const p of PRIVATE_HOST_PATTERNS) {
      if (p.test(host)) return undefined;
    }
    return parsed.href;
  } catch {}
  return undefined;
}
