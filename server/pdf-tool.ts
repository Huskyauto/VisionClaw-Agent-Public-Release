import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = process.cwd();

const BLOCKED_HOSTS = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254",
  "[::1]", "metadata.google.internal",
]);

function isUrlSafe(urlStr: string): { safe: boolean; error?: string } {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return { safe: false, error: "Only http/https URLs allowed" };
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return { safe: false, error: "Blocked host" };
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) return { safe: false, error: "Private IP range blocked" };
    if (host.endsWith(".local") || host.endsWith(".internal")) return { safe: false, error: "Internal hostname blocked" };
    return { safe: true };
  } catch {
    return { safe: false, error: "Invalid URL" };
  }
}

function isPathSafe(filePath: string): { safe: boolean; resolved?: string; error?: string } {
  try {
    const resolved = path.resolve(WORKSPACE_ROOT, filePath);
    if (!resolved.startsWith(WORKSPACE_ROOT)) {
      return { safe: false, error: "Path escapes workspace boundary" };
    }
    return { safe: true, resolved };
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
  const fn = mod.default?.default || mod.default || mod;
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
      const urlCheck = isUrlSafe(input);
      if (!urlCheck.safe) return { success: false, error: urlCheck.error };

      const resp = await fetch(input, {
        signal: AbortSignal.timeout(30000),
        headers: { "Accept": "application/pdf" },
        redirect: "manual",
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (location) {
          const redirectCheck = isUrlSafe(new URL(location, input).toString());
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
