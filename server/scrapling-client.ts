import { ssrfSafeUrl } from "./lib/ssrf-jail";
import { readResponseTextBounded } from "./lib/bounded-response";

const SCRAPLING_URL = (process.env.SCRAPLING_URL || "").replace(/\/+$/, "");
const SCRAPLING_ACCESS_KEY = process.env.SCRAPLING_ACCESS_KEY || "";
const SCRAPLING_ENABLED = process.env.SCRAPLING_ENABLED === "1";
const MAX_TIMEOUT_MS = 30_000;

export type ScraplingMode = "static";

export interface ScraplingResult {
  ok: boolean;
  engine: "scrapling";
  mode: ScraplingMode;
  sourceUrl: string;
  finalUrl?: string;
  status?: number;
  title?: string;
  text?: string;
  elapsedMs?: number;
  retryAfter?: string;
  retryAfterMs?: number;
  error?: string;
}

export function getScraplingStatus() {
  return {
    configured: SCRAPLING_ENABLED && Boolean(SCRAPLING_URL) && Boolean(SCRAPLING_ACCESS_KEY),
    enabled: SCRAPLING_ENABLED,
    url: SCRAPLING_URL,
    authConfigured: Boolean(SCRAPLING_ACCESS_KEY),
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export async function scraplingScrape(
  rawUrl: string,
  options: { mode?: ScraplingMode; timeoutMs?: number; requestId?: string } = {},
): Promise<ScraplingResult> {
  const mode = options.mode ?? "static";
  const safe = await ssrfSafeUrl(rawUrl);
  if (!safe.ok) {
    return { ok: false, engine: "scrapling", mode, sourceUrl: rawUrl, error: `URL rejected: ${safe.reason}` };
  }
  if (!getScraplingStatus().configured) {
    return { ok: false, engine: "scrapling", mode, sourceUrl: rawUrl, error: "Scrapling is disabled or not configured" };
  }
  let serviceUrl: URL;
  try {
    serviceUrl = new URL(SCRAPLING_URL);
  } catch {
    return { ok: false, engine: "scrapling", mode, sourceUrl: rawUrl, error: "Scrapling service URL is invalid" };
  }
  if (serviceUrl.protocol !== "https:") {
    return { ok: false, engine: "scrapling", mode, sourceUrl: rawUrl, error: "Scrapling service URL must use HTTPS" };
  }
  const timeoutMs = Math.max(3_000, Math.min(Math.trunc(options.timeoutMs ?? 20_000), MAX_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 2_000);
  const started = Date.now();
  try {
    const response = await fetch(`${serviceUrl.toString().replace(/\/+$/, "")}/v1/scrape`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SCRAPLING_ACCESS_KEY}`,
        "content-type": "application/json",
        ...(options.requestId ? { "x-request-id": options.requestId.slice(0, 128) } : {}),
      },
      body: JSON.stringify({ url: safe.url.toString(), mode, timeout_seconds: timeoutMs / 1000 }),
      signal: controller.signal,
    });
    const retryAfter = response.headers.get("retry-after") || undefined;
    const retryAfterMs = parseRetryAfter(retryAfter || null);
    const text = await readResponseTextBounded(response, 256_000, () => controller.abort());
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (parseError) {
      return {
        ok: false,
        engine: "scrapling",
        mode,
        sourceUrl: rawUrl,
        status: response.status,
        retryAfter,
        retryAfterMs,
        error: `Invalid Scrapling response: ${String((parseError as Error)?.message || parseError).slice(0, 180)}`,
        elapsedMs: Date.now() - started,
      };
    }
    if (!response.ok) {
      return {
        ok: false, engine: "scrapling", mode, sourceUrl: rawUrl, status: response.status,
        retryAfter, retryAfterMs,
        error: String(typeof body.error === "object" ? body.error?.error : body.error || body.detail || `HTTP ${response.status}`).slice(0, 300),
        elapsedMs: Date.now() - started,
      };
    }
    const validSuccessBody = body && typeof body === "object"
      && typeof body.sourceUrl === "string"
      && typeof body.finalUrl === "string"
      && typeof body.text === "string"
      && Number.isFinite(body.status)
      && Number.isFinite(body.elapsedMs);
    if (!validSuccessBody) {
      return {
        ok: false,
        engine: "scrapling",
        mode,
        sourceUrl: rawUrl,
        status: response.status,
        retryAfter,
        retryAfterMs,
        error: "Invalid Scrapling success response contract",
        elapsedMs: Date.now() - started,
      };
    }
    const finalUrl = String(body.finalUrl || body.sourceUrl || rawUrl);
    const finalSafe = await ssrfSafeUrl(finalUrl);
    if (!finalSafe.ok) {
      return { ok: false, engine: "scrapling", mode, sourceUrl: rawUrl, error: `Unsafe final URL: ${finalSafe.reason}` };
    }
    return {
      ok: true, engine: "scrapling", mode, sourceUrl: rawUrl, finalUrl,
      status: Number(body.status || 200), title: typeof body.title === "string" ? body.title.slice(0, 500) : undefined,
      text: typeof body.text === "string" ? body.text.slice(0, 20_000) : "",
      elapsedMs: Number(body.timingMs || Date.now() - started),
    };
  } catch (error: any) {
    return {
      ok: false, engine: "scrapling", mode, sourceUrl: rawUrl,
      error: error?.name === "AbortError" ? `Scrapling timed out after ${timeoutMs}ms` : String(error?.message || error).slice(0, 300),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}