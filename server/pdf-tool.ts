import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = process.cwd();
const UPLOADS_DIR = process.env.NODE_ENV === "production"
  ? path.resolve("/tmp", "uploads")
  : path.resolve(process.cwd(), "uploads");

const BLOCKED_HOSTS = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254",
  "::1", "metadata.google.internal",
]);

// R110 +sec gold-pass-5 — see server/tools.ts ipv4MappedToV4 for rationale.
// Node URL parser canonicalizes `[::ffff:127.0.0.1]` -> `::ffff:7f00:1`.
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

function isPrivateIp(ip: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("::ffff:")) {
    const v4 = ipv4MappedToV4(lower);
    if (v4 === null) return true;
    return isPrivateIp(v4);
  }
  return false;
}

// R110 +sec gold-pass-3 — Async SSRF guard with DNS re-validation.
// Hostname-only checks are bypassable by attacker-controlled DNS that
// resolves a public hostname to 169.254.169.254 (AWS/GCP metadata) or to
// 10.x/192.168.x. Resolve all A/AAAA records, reject if ANY is private.
async function isUrlSafe(urlStr: string): Promise<{ safe: boolean; error?: string }> {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { return { safe: false, error: "Invalid URL" }; }
  if (!["http:", "https:"].includes(parsed.protocol)) return { safe: false, error: "Only http/https URLs allowed" };
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return { safe: false, error: "Blocked host" };
  if (host.endsWith(".local") || host.endsWith(".internal")) return { safe: false, error: "Internal hostname blocked" };
  try {
    const net = await import("net");
    // R110 +sec gold-pass-4 — literal IPs MUST be checked via isPrivateIp,
    // not auto-allowed. Plugs ::1, fc00::/7 ULA, fe80::/10 link-local,
    // ::ffff: IPv4-mapped, and 100.64/10 CGNAT literal bypasses.
    if (net.isIP(host) !== 0) {
      if (isPrivateIp(host)) return { safe: false, error: `Literal IP ${host} is in a private/loopback/metadata range` };
      return { safe: true };
    }
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

function isPathSafe(filePath: string): { safe: boolean; resolved?: string; error?: string } {
  try {
    // Accept three input shapes:
    //   1) `/uploads/<filename>` or `uploads/<filename>` — URL form returned by /api/upload
    //   2) bare filename — assume it lives in the uploads dir
    //   3) absolute path or workspace-relative path
    let candidate = filePath.trim();

    if (candidate.startsWith("/uploads/") || candidate.startsWith("uploads/")) {
      const fname = candidate.replace(/^\/?uploads\//, "");
      const resolved = path.resolve(UPLOADS_DIR, fname);
      if (!resolved.startsWith(UPLOADS_DIR)) {
        return { safe: false, error: "Path escapes uploads boundary" };
      }
      return { safe: true, resolved };
    }

    const resolved = path.resolve(WORKSPACE_ROOT, candidate);
    if (resolved.startsWith(WORKSPACE_ROOT) || resolved.startsWith(UPLOADS_DIR)) {
      return { safe: true, resolved };
    }

    // Bare filename that didn't resolve to anything sensible — try uploads dir.
    if (!candidate.includes("/")) {
      const fallback = path.resolve(UPLOADS_DIR, candidate);
      if (fallback.startsWith(UPLOADS_DIR)) {
        return { safe: true, resolved: fallback };
      }
    }

    return { safe: false, error: "Path escapes workspace boundary" };
  } catch {
    return { safe: false, error: "Invalid path" };
  }
}

interface PdfResult {
  success: boolean;
  text?: string;
  pages?: number;
  title?: string;
  error?: string;
  source?: string;
  truncated?: boolean;
}

async function loadPdfParse() {
  const mod = await import("pdf-parse");
  const fn = (mod as any).default?.default || (mod as any).default || mod;
  if (typeof fn !== "function") {
    throw new Error(`pdf-parse module loaded but is not a function (type: ${typeof fn}). Keys: ${Object.keys(mod).join(", ")}`);
  }
  return fn;
}

export async function extractPdfText(input: string, options?: {
  pages?: string;
  maxBytes?: number;
}): Promise<PdfResult> {
  const maxBytes = (options?.maxBytes || 10) * 1024 * 1024;

  try {
    let buffer: Buffer;
    let source: string;

    if (input.startsWith("http://") || input.startsWith("https://")) {
      source = "url";
      const urlCheck = await isUrlSafe(input);
      if (!urlCheck.safe) return { success: false, error: urlCheck.error };

      const resp = await fetch(input, {
        signal: AbortSignal.timeout(30000),
        headers: { "Accept": "application/pdf" },
        redirect: "manual",
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (location) {
          const redirectCheck = await isUrlSafe(new URL(location, input).toString());
          if (!redirectCheck.safe) return { success: false, error: `Redirect blocked: ${redirectCheck.error}` };
        }
        return { success: false, error: "PDF fetch was redirected to a blocked destination" };
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching PDF`);
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
        throw new Error(`Not a PDF: content-type is ${contentType}`);
      }
      const ab = await resp.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        throw new Error(`PDF exceeds ${options?.maxBytes || 10}MB limit (${(ab.byteLength / 1024 / 1024).toFixed(1)}MB)`);
      }
      buffer = Buffer.from(ab);
    } else {
      source = "file";
      const pathCheck = isPathSafe(input);
      if (!pathCheck.safe) return { success: false, error: pathCheck.error };
      const filePath = pathCheck.resolved!;

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        throw new Error(`PDF exceeds ${options?.maxBytes || 10}MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
      }
      buffer = fs.readFileSync(filePath);
    }

    const pdfParse = await loadPdfParse();
    const data = await pdfParse(buffer);

    let text = data.text || "";
    const totalPages = data.numpages || 0;

    if (options?.pages) {
      const pageNumbers = parsePageFilter(options.pages, totalPages);
      const pageTexts = text.split(/\f/);
      text = pageNumbers
        .filter(p => p <= pageTexts.length)
        .map(p => `--- Page ${p} ---\n${pageTexts[p - 1]?.trim() || "(empty)"}`)
        .join("\n\n");
    }

    const truncated = text.length > 12000;
    if (truncated) text = text.slice(0, 12000);

    return {
      success: true,
      text,
      pages: totalPages,
      title: data.info?.Title || undefined,
      source,
      truncated,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "PDF extraction failed",
    };
  }
}

function parsePageFilter(filter: string, maxPages: number): number[] {
  const pages = new Set<number>();
  const parts = filter.split(",").map(s => s.trim());
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(end, maxPages); i++) {
          pages.add(i);
        }
      }
    } else {
      const n = Number(part);
      if (!isNaN(n) && n >= 1 && n <= maxPages) pages.add(n);
    }
  }
  return [...pages].sort((a, b) => a - b);
}
