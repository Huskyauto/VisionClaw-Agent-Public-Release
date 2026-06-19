const BARE_URL_RE = /https?:\/\/\S+/gi;
const MARKDOWN_LINK_RE = /\[[^\]]*]\((https?:\/\/\S+?)\)/gi;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

const MAX_LINKS = 3;
const MAX_FETCH_BYTES = 100_000;
const FETCH_TIMEOUT_MS = 8_000;

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(lower)) return true;
  if (lower.endsWith(".internal") || lower.endsWith(".local")) return true;
  if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(lower)) return true;
  return false;
}

function isAllowedUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (isBlockedHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractLinksFromMessage(message: string): string[] {
  const source = message?.trim();
  if (!source) return [];

  const seen = new Set<string>();
  const results: string[] = [];

  for (const match of source.matchAll(MARKDOWN_LINK_RE)) {
    const raw = match[1]?.replace(/[.,;:!?)\]}>]+$/, "").trim();
    if (!raw || !isAllowedUrl(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    results.push(raw);
    if (results.length >= MAX_LINKS) break;
  }

  const sanitized = source.replace(MARKDOWN_LINK_RE, " ");
  for (const match of sanitized.matchAll(BARE_URL_RE)) {
    const raw = match[0]?.replace(/[.,;:!?)\]}>]+$/, "").trim();
    if (!raw || !isAllowedUrl(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    results.push(raw);
    if (results.length >= MAX_LINKS) break;
  }

  return results;
}

export interface LinkUnderstandingResult {
  url: string;
  title?: string;
  content?: string;
  error?: string;
}

async function fetchUrlContent(url: string): Promise<LinkUnderstandingResult> {
  try {
    // R116.2 — DNS-resolve SSRF pre-check (catches private IPs after DNS,
    // not just hostname-string match). The inline `isBlockedHost` only filters
    // by string shape, so a public name resolving to a private IP slipped
    // through.
    const { ssrfSafeUrl } = await import("./lib/ssrf-jail");
    const jail = await ssrfSafeUrl(url);
    if (!jail.ok) return { url, error: `unsafe url: ${jail.reason}` };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // R116.2 — redirect:"error" instead of "follow". `follow` would let a
    // jailed public URL 30x into an internal target, bypassing the SSRF
    // jail. Link-understanding is opportunistic enrichment on agent-extracted
    // URLs; legit content servers resolve directly. URL-shorteners fail fast
    // (acceptable — user should paste canonical URL). Same pattern as
    // `server/reference-learner.ts:32`.
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VisionClaw/1.0 (Link Understanding)",
        Accept: "text/html, text/plain, application/json",
      },
      redirect: "error",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { url, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      !contentType.includes("text/") &&
      !contentType.includes("application/json") &&
      !contentType.includes("application/xml")
    ) {
      return { url, error: `Non-text content type: ${contentType}` };
    }

    const text = await response.text();
    const truncated = text.slice(0, MAX_FETCH_BYTES);

    let title: string | undefined;
    const titleMatch = truncated.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 200);
    }

    let content: string;
    if (contentType.includes("text/html")) {
      content = extractTextFromHtml(truncated);
    } else {
      content = truncated;
    }

    if (content.length > 4000) {
      content = content.slice(0, 4000) + "\n[Content truncated]";
    }

    return { url, title, content };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { url, error: "Fetch timed out" };
    }
    return { url, error: err.message || "Unknown fetch error" };
  }
}

function extractTextFromHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

export async function understandLinks(
  message: string
): Promise<LinkUnderstandingResult[]> {
  const urls = extractLinksFromMessage(message);
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(urls.map(fetchUrlContent));

  return results
    .filter(
      (r): r is PromiseFulfilledResult<LinkUnderstandingResult> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);
}

export function formatLinkContext(results: LinkUnderstandingResult[]): string {
  if (results.length === 0) return "";

  const sections = results
    .filter((r) => !r.error && r.content)
    .map((r) => {
      const title = r.title ? ` — "${r.title}"` : "";
      return `[Link: ${r.url}${title}]\n${r.content}`;
    });

  if (sections.length === 0) return "";

  return (
    "\n\n--- Auto-fetched Link Context ---\n" +
    sections.join("\n\n") +
    "\n--- End Link Context ---"
  );
}
