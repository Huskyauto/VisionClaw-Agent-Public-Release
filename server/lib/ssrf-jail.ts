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
import { logSilentCatch } from "./silent-catch";

// R98.16+sec — architect HIGH fix: extended private/reserved IP coverage.
// Now blocks: RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1),
// link-local (169.254/16, fe80:), CGNAT (100.64.0.0/10 — used inside many
// container/cloud platforms for their own NAT layer, including some
// metadata fronts), 0.0.0.0/8 (this-network), IPv4 multicast 224-239/4
// (could be abused to hit a multicast listener on the host), and IPv6
// ULA (fc00::/7 → fc/fd), IPv6 multicast (ff::/8), and IPv4-mapped IPv6
// (::ffff:10.0.0.1 form).
const PRIVATE_IP_RE = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|23\d\.|::1$|::ffff:(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|ff[0-9a-f]{2}:)/i;
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

export type SsrfCheckResult = { ok: true; url: URL } | { ok: false; reason: string };

export async function ssrfSafeUrl(rawUrl: string): Promise<SsrfCheckResult> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "not a valid URL" }; }
  if (u.protocol !== "https:") return { ok: false, reason: `protocol '${u.protocol}' rejected (https only)` };
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: `hostname '${host}' blocked` };
  for (const sfx of BLOCKED_SUFFIXES) {
    if (host === sfx.slice(1) || host.endsWith(sfx)) return { ok: false, reason: `hostname suffix '${sfx}' blocked (internal cluster TLD)` };
  }
  if (PRIVATE_IP_RE.test(host)) return { ok: false, reason: `private/link-local IP '${host}' blocked` };
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records || records.length === 0) return { ok: false, reason: `DNS returned no records for '${host}'` };
    for (const r of records) {
      if (PRIVATE_IP_RE.test(r.address)) return { ok: false, reason: `hostname resolves to private IP '${r.address}' (rebinding-defense)` };
    }
  } catch (e: any) {
    return { ok: false, reason: `DNS lookup failed: ${e?.message || String(e)}` };
  }
  return { ok: true, url: u };
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
  try {
    const res = await fetch(safe.url.toString(), {
      signal: ctrl.signal,
      redirect: "error",                     // never follow — a 30x to internal host would bypass the jail
      headers: { "User-Agent": opts?.userAgent || "VisionClaw/1.0" },
    });
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
  }
}
