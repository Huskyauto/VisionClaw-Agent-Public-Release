import { logSilentCatch } from "./silent-catch";

function resolveBase(): string {
  const raw = process.env.MONID_API_BASE || "https://api.monid.ai/v1";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") {
      console.warn(`[monid] MONID_API_BASE protocol ${u.protocol} rejected — falling back to https://api.monid.ai/v1`);
      return "https://api.monid.ai/v1";
    }
    if (!/(^|\.)monid\.ai$/i.test(u.hostname)) {
      console.warn(`[monid] MONID_API_BASE host ${u.hostname} not in monid.ai allowlist — falling back to https://api.monid.ai/v1`);
      return "https://api.monid.ai/v1";
    }
    return raw.replace(/\/$/, "");
  } catch (e: any) {
    // R110.11 — log on URL parse failure. Silent fallback hid misconfigured
    // MONID_API_BASE values (e.g. typos that would otherwise spend at default).
    console.warn(`[monid] MONID_API_BASE parse failed (${e?.message || e}) — falling back to https://api.monid.ai/v1`);
    return "https://api.monid.ai/v1";
  }
}
const MONID_BASE = resolveBase();
const MONID_TIMEOUT_MS = Number(process.env.MONID_TIMEOUT_MS || 30000);
const MAX_ERROR_BODY_CHARS = 600;

function trimErrorBody(body: any): any {
  if (body == null) return undefined;
  if (typeof body === "string") return body.slice(0, MAX_ERROR_BODY_CHARS);
  if (typeof body === "object") {
    const msg = (body as any)?.message ?? (body as any)?.error ?? (body as any)?.detail;
    if (typeof msg === "string") return msg.slice(0, MAX_ERROR_BODY_CHARS);
  }
  try { return JSON.stringify(body).slice(0, MAX_ERROR_BODY_CHARS); } catch { return "[unserializable error body]"; }
}

function authHeader(): Record<string, string> {
  const key = process.env.MONID_API_KEY;
  if (!key) {
    throw new Error("MONID_API_KEY not set — ask the user to add the secret (https://app.monid.ai/access/api-keys).");
  }
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "VisionClaw/1.0 (+https://visionclaw.replit.app)",
  };
}

async function monidFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
  const url = `${MONID_BASE}${path}`;
  const ctrl = new AbortController();
  const timeoutMs = init.timeoutMs ?? MONID_TIMEOUT_MS;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...authHeader(), ...(init.headers || {}) },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch (_silentErr) { logSilentCatch("server/lib/monid.ts", _silentErr); }
    if (!res.ok) {
      return { error: `Monid ${path} returned ${res.status}`, status: res.status, body: trimErrorBody(body) };
    }
    return body;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { error: `Monid ${path} timed out after ${timeoutMs}ms` };
    }
    return { error: `Monid ${path} failed: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(t);
  }
}

export async function monidDiscover(args: { query: string; limit?: number; minScore?: number }): Promise<any> {
  const query = String(args?.query || "").trim();
  if (!query) return { error: "monid_discover: 'query' is required" };
  const limit = Math.max(1, Math.min(50, Number(args?.limit) || 10));
  const body: any = { query, limit };
  if (typeof args?.minScore === "number") body.min_score = Math.max(0, Math.min(1, args.minScore));
  return monidFetch("/discover", { method: "POST", body: JSON.stringify(body) });
}

function splitId(args: { id?: string; provider?: string; endpoint?: string }): { provider: string; endpoint: string } | { error: string } {
  let provider = String(args?.provider || "").trim();
  let endpoint = String(args?.endpoint || "").trim();
  if (!provider || !endpoint) {
    const id = String(args?.id || "").trim();
    if (!id) return { error: "Need either {provider, endpoint} or a combined {id} like 'apify/data_xplorer/google-news-scraper-fast' (from monid_discover result)." };
    const slash = id.indexOf("/");
    if (slash <= 0) return { error: `id '${id}' does not contain '/'; expected 'provider/endpoint-path' (from monid_discover result).` };
    provider = id.slice(0, slash);
    endpoint = id.slice(slash);
  }
  if (!endpoint.startsWith("/")) endpoint = "/" + endpoint;
  if (endpoint === "/" || !endpoint.slice(1).trim()) {
    return { error: `endpoint must be a non-empty path like '/x402/google-search' (got '${endpoint}').` };
  }
  return { provider, endpoint };
}

export async function monidInspect(args: { id?: string; provider?: string; endpoint?: string }): Promise<any> {
  const split = splitId(args);
  if ("error" in split) return split;
  return monidFetch("/inspect", { method: "POST", body: JSON.stringify({ provider: split.provider, endpoint: split.endpoint }) });
}

export async function monidRun(args: {
  id?: string;
  provider?: string;
  endpoint?: string;
  body?: Record<string, any>;
  query?: Record<string, any>;
  path?: Record<string, any>;
  wait?: boolean;
  timeoutMs?: number;
}): Promise<any> {
  const split = splitId(args);
  if ("error" in split) return split;
  const payload: any = { provider: split.provider, endpoint: split.endpoint };
  if (args?.body && typeof args.body === "object") payload.body = args.body;
  if (args?.query && typeof args.query === "object") payload.queryParams = args.query;
  if (args?.path && typeof args.path === "object") payload.pathParams = args.path;
  if (typeof args?.wait === "boolean") payload.wait = args.wait;
  const t = Math.max(5000, Math.min(180000, Number(args?.timeoutMs) || 60000));
  const result: any = await monidFetch("/run", { method: "POST", body: JSON.stringify(payload), timeoutMs: t });
  // Friendly hint when the upstream rejects with "Missing required fields" — the #1 agent failure mode
  // is guessing whether a param goes in body vs query vs path. Surface the inspect schema explicitly so
  // the next call gets it right without burning another paid retry.
  try {
    const upstreamErr = result?.providerResponse?.error?.error || result?.providerResponse?.error;
    const upstreamSchema = result?.providerResponse?.error?.input_schema;
    if (typeof upstreamErr === "string" && /missing required field/i.test(upstreamErr) && upstreamSchema) {
      const required = upstreamSchema?.required;
      const props = upstreamSchema?.properties ? Object.keys(upstreamSchema.properties) : null;
      result._hint =
        `Upstream rejected the call. The endpoint expects required field(s): ${JSON.stringify(required)} ` +
        (props ? `(known properties: ${JSON.stringify(props)}). ` : "") +
        `Re-run monid_inspect on this id and copy the param shape exactly — pathParams → path, queryParams → query, body → body. ` +
        `You were billed for this call; do not retry without verifying the shape first.`;
    }
  } catch (_silentErr) { logSilentCatch("server/lib/monid.ts:monidRun:hint", _silentErr); }
  return result;
}
