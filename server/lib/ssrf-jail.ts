// Shared SSRF jail. Single source of truth for "is this URL safe to fetch?"
// Used by: reference-learner.ts, mpeg-engine.ts, and any other surface that
// fetches a URL coming from a model output, customer message, or DB row.
//
// Defense layers:
//   1. https-only (rejects http://, file://, ftp://, javascript:, data: in URL form, etc.)
//   2. Hostname blocklist for well-known internal/metadata names.
//   3. Private/link-local/loopback IP regex on the literal hostname.
//   4. DNS resolution + post-resolution recheck on every returned address (DNS rebinding defense).
//
// Callers MUST also use redirect:"error" on their fetch (or re-jail post-redirect)
// since we cannot control redirect chains from inside this function.
//
// R104 — Image-generation SSRF audit (cross-checked against openclaw#79765
// "propagate image generation SSRF policy"). Surfaces verified clean as of
// R104:
//   - `grade_deliverable.expected_spec.thumbnail_paths` — `deliverable-grader.ts`
//     enforces local-path-or-data-URI only; remote URLs rejected pre-vision-LLM
//     (architect HIGH fix, R98.13+sec).
//   - `internal generate_image` — prompt-string in, data-URI out; no URL surface.
//   - `mpeg_produce_parallel` scenes — `imagePath` is local; `imagePrompt` is
//     a string sent to the image generator; no remote URL fetch.
//   - Mermaid render → `mermaid.ink` / `kroki.io` — fixed allowlisted hosts
//     constructed in code, not user-controlled.
//   - `grade_deliverable.file_url` — recorded but not fetched.
//   - All image-vision callers feed pre-validated thumbs into `runLlmTask`,
//     never raw remote URLs.
// Any new image-bearing tool MUST either route through `ssrfSafeFetchBytes` or
// reject remote URLs at the schema layer (preferred). Add the new tool to this
// audit comment when introduced.

import * as dns from "dns/promises";
import { Agent } from "undici";
import { logSilentCatch } from "./silent-catch";

// Closes the DNS-rebinding TOCTOU in ssrfSafeFetchBytes: ssrfSafeUrl() validates
// the IPs the hostname currently resolves to, but a plain fetch() re-resolves at
// connect time, so a hostile DNS server could swap in a private IP between check
// and connect. This dispatcher overrides the socket's DNS lookup to return ONLY
// those already-validated IPs, while leaving TLS SNI + Host header bound to the
// real hostname. Mirrors server/audit-engine.ts pinnedDispatcher().
function pinnedDispatcher(addresses: string[]): Agent {
  const mapped = addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  return new Agent({
    connect: {
      lookup: (_hostname: string, options: any, cb: any) => {
        // Return every validated IP when the caller asks for all; otherwise honor
        // a requested family (falling back to the first) so multi-address hosts
        // stay reachable while remaining pinned to validated IPs only.
        if (options && options.all) { cb(null, mapped as any); return; }
        const fam = options?.family;
        const pick = (fam === 4 || fam === 6) ? (mapped.find((m) => m.family === fam) || mapped[0]) : mapped[0];
        cb(null, pick.address, pick.family);
      },
    },
  });
}

// Private/reserved IP detection. Originally a regex over the literal hostname,
// but that had a SSRF BYPASS: Node's URL.hostname HEX-normalizes IPv4-mapped
// IPv6 (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`), so the regex's dotted
// `::ffff:127.` alternatives were dead code and `https://[::ffff:7f00:1]/`
// (= loopback) sailed through. We now parse the literal to its raw bytes and
// classify on the bytes — an ALLOWLIST: only ordinary public unicast passes.
// Everything else (loopback, RFC1918, link-local 169.254 + fe80::/10, CGNAT
// 100.64/10, 0.0.0.0/8, benchmark 198.18/15, multicast, IPv6 ULA fc00::/7,
// IPv6 multicast ff00::/8, AND IPv4-mapped-to-anything-private) is blocked.
// The test suite cross-validates this against ipaddr.js over a wide sample.

// Parse an IPv4 or IPv6 literal to its raw bytes (4 for v4, 16 for v6),
// or null if the string is not an IP literal (then it's a hostname → DNS path).
function parseIpToBytes(raw: string): number[] | null {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) {
    const o = raw.split(".").map(Number);
    return o.every((n) => n >= 0 && n <= 255) ? o : null;
  }
  if (!raw.includes(":")) return null;
  let s = raw.toLowerCase();
  // Embedded dotted IPv4 in the last 32 bits (e.g. `::ffff:1.2.3.4`) → fold to hextets.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const o = tail.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
    s = s.slice(0, lastColon + 1) +
      ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const dbl = s.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(":") : [];
  const tailGroups = dbl.length === 2 ? (dbl[1] ? dbl[1].split(":") : []) : null;
  let groups: string[];
  if (tailGroups === null) {
    groups = head;
  } else {
    const missing = 8 - head.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tailGroups];
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function ipv4Blocked(o: number[]): string | null {
  const [a, b, c] = o;
  void c;
  if (a === 0) return "0.0.0.0/8 (this-network)";
  if (a === 10) return "10/8 (RFC1918 private)";
  if (a === 127) return "127/8 (loopback)";
  if (a === 169 && b === 254) return "169.254/16 (link-local)";
  if (a === 172 && b >= 16 && b <= 31) return "172.16/12 (RFC1918 private)";
  if (a === 192 && b === 168) return "192.168/16 (RFC1918 private)";
  if (a === 100 && b >= 64 && b <= 127) return "100.64/10 (CGNAT)";
  if (a === 198 && (b === 18 || b === 19)) return "198.18/15 (benchmark)";
  if (a >= 224) return `${a}/4 (multicast/reserved)`;
  return null;
}

// Returns a human-readable block reason, or null if the literal is a public
// unicast address (or not an IP literal at all).
export function blockedIpReason(raw: string): string | null {
  const bytes = parseIpToBytes(raw);
  if (!bytes) return null;
  if (bytes.length === 4) return ipv4Blocked(bytes);
  // IPv6 (16 bytes)
  // IPv4-mapped ::ffff:0:0/96 → classify the embedded IPv4 (covers the hex bypass).
  if (bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const r = ipv4Blocked(bytes.slice(12));
    return r ? `IPv4-mapped → ${r}` : null;
  }
  if (bytes.every((x) => x === 0)) return ":: (unspecified)";
  if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return "::1 (loopback)";
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return "fe80::/10 (link-local)";
  if ((bytes[0] & 0xfe) === 0xfc) return "fc00::/7 (unique-local)";
  if (bytes[0] === 0xff) return "ff00::/8 (multicast)";
  return null;
}
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0",
  "instance-data",                           // AWS legacy metadata alias
  "metadata.azure.com",
  "metadata.aws",
  "metadata.aws.amazon.com",
  "kubernetes.default.svc",                  // K8s in-cluster API
  "kubernetes.default.svc.cluster.local",
]);
// Suffix-blocklist for internal Replit/Railway/cluster TLDs that aren't
// a single hostname but a whole tree. Block .internal entirely (covers
// *.railway.internal, *.replit.internal, *.k8s.internal etc).
const BLOCKED_SUFFIXES = [".internal", ".cluster.local", ".svc"];

// `addresses` carries the exact IP literals that were validated during this
// check. Callers that want to fully close the DNS-rebinding TOCTOU (resolve →
// validate → connect re-resolves to a different IP) MUST pin their connection
// to these addresses instead of letting the socket re-resolve the hostname.
// Consumed by `pinnedDispatcher()` in BOTH ssrfSafeFetchBytes (below) and
// server/audit-engine.ts. Regression-guarded by tests/security/ssrf-pinned-addresses.test.ts.
export type SsrfCheckResult = { ok: true; url: URL; addresses: string[] } | { ok: false; reason: string };

export async function ssrfSafeUrl(rawUrl: string): Promise<SsrfCheckResult> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "not a valid URL" }; }
  if (u.protocol !== "https:") return { ok: false, reason: `protocol '${u.protocol}' rejected (https only)` };
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: `hostname '${host}' blocked` };
  for (const sfx of BLOCKED_SUFFIXES) {
    if (host === sfx.slice(1) || host.endsWith(sfx)) return { ok: false, reason: `hostname suffix '${sfx}' blocked (internal cluster TLD)` };
  }
  // Node's URL.hostname returns IPv6 literals WRAPPED in brackets ("[fe80::1]"),
  // so strip them before classifying — otherwise the literal-IP block can't see
  // the address at all and IPv6 literals fall through to the fragile DNS path.
  const ipLiteral = host.replace(/^\[/, "").replace(/\]$/, "");
  const literalBlock = blockedIpReason(ipLiteral);
  if (literalBlock) return { ok: false, reason: `private/reserved IP '${host}' blocked (${literalBlock})` };
  try {
    // Use the bracket-stripped host: dns.lookup() of a numeric IP literal
    // returns it verbatim (so public IPv6 literals like 2606:4700:4700::1111
    // resolve to themselves and pass), while hostnames resolve normally. The
    // post-resolution recheck below is the DNS-rebinding defense.
    const records = await dns.lookup(ipLiteral, { all: true });
    if (!records || records.length === 0) return { ok: false, reason: `DNS returned no records for '${host}'` };
    for (const r of records) {
      const resolvedBlock = blockedIpReason(r.address);
      if (resolvedBlock) return { ok: false, reason: `hostname resolves to private IP '${r.address}' (${resolvedBlock}, rebinding-defense)` };
    }
    return { ok: true, url: u, addresses: records.map((r) => r.address) };
  } catch (e: any) {
    return { ok: false, reason: `DNS lookup failed: ${e?.message || String(e)}` };
  }
}

// Convenience helper: fetch with the jail + a hard timeout + body cap. Returns
// the raw bytes (Buffer) plus content-type. Caller decides how to interpret.
// Refuses redirects (a redirect to an internal host would bypass the input jail).
export async function ssrfSafeFetchBytes(rawUrl: string, opts?: { timeoutMs?: number; maxBytes?: number; userAgent?: string }): Promise<{ ok: true; bytes: Buffer; contentType: string; finalUrl: string } | { ok: false; reason: string }> {
  const safe = await ssrfSafeUrl(rawUrl);
  if (!safe.ok) return safe;
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxBytes = opts?.maxBytes ?? 4 * 1024 * 1024;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // Pin the socket to the IPs ssrfSafeUrl() already validated so a hostile DNS
  // server can't rebind the hostname to a private IP between check and connect.
  const dispatcher = pinnedDispatcher(safe.addresses);
  try {
    const res = await fetch(safe.url.toString(), {
      signal: ctrl.signal,
      redirect: "error",                     // never follow — a 30x to internal host would bypass the jail
      headers: { "User-Agent": opts?.userAgent || "VisionClaw/1.0" },
      dispatcher,
    } as any);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") || "";
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: "no body stream" };
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch (_silentErr) { logSilentCatch("server/lib/ssrf-jail.ts", _silentErr); }
        return { ok: false, reason: `body exceeds ${maxBytes}B cap` };
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { ok: true, bytes: buf, contentType: ct, finalUrl: safe.url.toString() };
  } catch (e: any) {
    return { ok: false, reason: `fetch failed: ${e?.message || String(e)}` };
  } finally {
    clearTimeout(t);
    dispatcher.destroy().catch((_silentErr) => logSilentCatch("server/lib/ssrf-jail.ts", _silentErr));
  }
}
