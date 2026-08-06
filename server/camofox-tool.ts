import { logSilentCatch } from "./lib/silent-catch";

const CAMOFOX_URL = (process.env.CAMOFOX_URL || "").replace(/\/+$/, "");
const CAMOFOX_ACCESS_KEY = process.env.CAMOFOX_ACCESS_KEY || "";
const CAMOFOX_REQUIRE_AUTH = (process.env.CAMOFOX_REQUIRE_AUTH ?? "true") !== "false";
const REQUEST_TIMEOUT_MS = 60_000;

// R96 review fix: configured = URL set AND (auth key present OR explicit
// opt-out via CAMOFOX_REQUIRE_AUTH=false). Prevents accidentally calling a
// public-internet stealth-browser endpoint with no bearer.
export function isCamofoxConfigured(): boolean {
  if (!CAMOFOX_URL) return false;
  if (CAMOFOX_REQUIRE_AUTH && !CAMOFOX_ACCESS_KEY) return false;
  return true;
}

// R96 review fix: userIdSuffix is LLM-controlled. Restrict to a tight
// allowlist (lowercase alphanumerics + dash/underscore, max 32 chars) so
// it cannot pollute the upstream Camofox session namespace or escape the
// `vc-tenant-${tenantId}-` prefix via path-like input.
function sanitizeUserIdSuffix(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return cleaned || undefined;
}

// R96.1 — Web-block detector + escalation hint. Any persona's web tool
// (web_fetch, browser, stealth_browse, firecrawl_scrape) that comes back
// with a 403 / Cloudflare interstitial / hCaptcha challenge / "are you a
// robot" / Akamai bot-manager block / etc. gets a `_fallback_hint` field
// appended pointing at `stealth_browse_camofox`. The model literally sees
// this string in the failed tool result on the next turn and reaches for
// the Camoufox stealth browser without the user having to tell it. This
// is how doctrine #3 ("when stuck, change strategy") becomes mechanical
// instead of aspirational.
const BLOCK_PATTERNS = [
  /\b403\b|forbidden/i,
  /cloudflare|cf-ray|attention required/i,
  /captcha|recaptcha|hcaptcha|are you (a )?human|are you (a )?robot/i,
  /access denied|access to this page has been denied|blocked by/i,
  /akamai|incapsula|perimeterx|datadome|kasada|f5 bot/i,
  /bot detection|automated traffic|unusual traffic/i,
  /please enable javascript|js challenge|browser check/i,
  /\b429\b|rate limit|too many requests/i,
];

// R96.1+architect-MEDIUM-#5 fix: only scan a bounded set of known fields
// instead of JSON.stringify-ing the whole payload. This prevents an article
// page returned in `content` from triggering on a single mention of
// "captcha" AND avoids the CPU/perf footgun of stringifying 200KB HTML.
// Strong-evidence fields (error / errorMessage / message / status code /
// engine note) get a low bar; soft-evidence fields (title / body snippet)
// require the payload to ALSO have set an explicit failure flag.
// R96.1+architect-followup: added `message` — common blocker shape is
// `{ success: false, message: "Cloudflare challenge..." }` and we were
// missing it.
const STRONG_FIELDS = ["error", "errorMessage", "message", "_error", "statusText"];
const SOFT_FIELDS = ["title", "snapshot", "content", "html", "body", "text", "_note"];

function fieldText(payload: any, key: string): string {
  const v = payload?.[key];
  if (typeof v === "string") return v.slice(0, 4096);
  return "";
}

function looksBlocked(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  const failFlag = payload.success === false || payload.ok === false || !!payload.error;
  const status = Number(payload?.status ?? payload?.statusCode);
  const httpFail = Number.isFinite(status) && status >= 400;
  // 1) Strong evidence: explicit error / status fields name a block pattern.
  // Architect-followup polish: `message` is informational on many tools
  // (e.g. browser close_session returns {message: "Closed"}), so it only
  // counts as "strong" when the payload ALSO has failure evidence (failure
  // flag OR HTTP >= 400). The other strong fields (error/errorMessage/
  // _error/statusText) keep their single-hit semantics — their existence
  // alone implies failure.
  for (const key of STRONG_FIELDS) {
    const t = fieldText(payload, key);
    if (!t) continue;
    if (key === "message" && !(failFlag || httpFail)) continue;
    if (BLOCK_PATTERNS.some((re) => re.test(t))) return true;
  }
  // HTTP status: 401/403/407/429/451 are bot-block-shaped
  if ([401, 403, 407, 429, 451].includes(status)) return true;
  // 2) Soft evidence requires the payload to ALSO have flagged failure
  if (!failFlag) return false;
  // Need at least 2 distinct pattern hits across the soft fields to fire
  let hits = 0;
  for (const key of SOFT_FIELDS) {
    const t = fieldText(payload, key);
    if (!t) continue;
    for (const re of BLOCK_PATTERNS) {
      if (re.test(t)) { hits++; if (hits >= 2) return true; break; }
    }
  }
  return false;
}

// Softened wording — informational, not imperative. The previous version
// included "Do NOT report 'I cannot access this site' to the user" which
// architect flagged as a prompt-injection vector if a hostile page could
// trigger this hint and use it to suppress legitimate failure messages.
const FALLBACK_HINT_TEXT =
  "Site appears blocked (bot detection / captcha / Cloudflare / DataDome). " +
  "Suggested escalation ladder before reporting failure to the user: " +
  "firecrawl_scrape (managed proxy) → stealth_browse (fingerprint spoofing) → " +
  "stealth_browse_camofox (Camoufox-based, full fingerprint + per-tenant persisted session). " +
  "If a tier doesn't help, fall back to the user with a precise blocker.";

export function annotateWebToolResult<T>(result: T, sourceTool: string): T {
  try {
    if (sourceTool === "stealth_browse_camofox") return result; // already at top of ladder
    if (!looksBlocked(result)) return result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      // R96.1+architect-MEDIUM-#6 + followup-CRITICAL fix: hint goes at TOP
      // of the object so JSON.stringify-then-truncate (chat-engine.ts:2544
      // + compaction.ts:159, slice to first 1500 chars) preserves it.
      // Architect re-review caught that chat-engine.ts:3243 strips ALL "_"-
      // prefixed keys from tool output as a prompt-injection guard, which
      // was silently deleting `_fallback_hint` before the model ever saw
      // it. Switched to non-underscore keys (`fallbackHint` /
      // `fallbackTool`) so they survive the strip — the strip exists to
      // block hostile tool authors from injecting fake control fields like
      // `_circuitBreak` or `_autoCorrect`, and these new keys are not
      // reserved control surfaces, just informational metadata.
      const hinted: any = {
        fallbackHint: FALLBACK_HINT_TEXT,
        fallbackTool: "stealth_browse_camofox",
      };
      for (const k of Object.keys(result as any)) hinted[k] = (result as any)[k];
      return hinted as T;
    }
  } catch (e) {
    logSilentCatch("annotateWebToolResult", e);
  }
  return result;
}

// Same allowlist treatment for sessionKey — LLM-controlled and used as a
// session-storage discriminator inside Camofox.
function sanitizeSessionKey(raw: string | undefined): string {
  if (!raw) return "default";
  const cleaned = String(raw).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  return cleaned || "default";
}

export interface CamofoxStatus {
  configured: boolean;
  url: string;
  authConfigured: boolean;
}

export function getCamofoxStatus(): CamofoxStatus {
  return {
    configured: isCamofoxConfigured(),
    url: CAMOFOX_URL,
    authConfigured: Boolean(CAMOFOX_ACCESS_KEY),
  };
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (CAMOFOX_ACCESS_KEY) h["Authorization"] = `Bearer ${CAMOFOX_ACCESS_KEY}`;
  return h;
}

async function camoFetch(path: string, init: RequestInit = {}): Promise<any> {
  if (!isCamofoxConfigured()) {
    throw new Error("Camofox not configured. Set CAMOFOX_URL.");
  }
  const url = `${CAMOFOX_URL}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers as any || {}) },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch (_silentErr) { logSilentCatch("server/camofox-tool.ts", _silentErr); }
    if (!r.ok) {
      const msg = (body && typeof body === "object" && (body.error || body.message)) || `HTTP ${r.status}`;
      throw new Error(`Camofox ${path}: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// R96.1+architect-HIGH-#3 fix: cookie/storage isolation is now keyed on
// (tenantId, personaId) by default, with the optional sanitized suffix
// appended last. Personas inside the same tenant (e.g. Robert-medical and
// Felix-CEO under tenant 1) used to share `vc-tenant-1` cookies + storage
// — that's a cross-persona session-bleed surface. The personaId comes from
// the dispatch layer (chat-engine.ts:3136 already injects `_personaId`),
// NOT from LLM-controlled args, so the model cannot pick another persona's
// session out from under it.
function tenantUserId(tenantId: number, personaId?: number, userIdSuffix?: string): string {
  const safeTenant = Number.isFinite(tenantId) ? Math.trunc(tenantId) : 0;
  const safePersona = Number.isFinite(personaId as number) ? Math.trunc(personaId as number) : 0;
  // Architect-followup: warn if persona context missing — every prod
  // dispatch path injects _personaId, so a missing one means a test
  // harness or new caller forgot to pass it, and we'd be sharing the
  // tenant-wide cookie jar across personas. Don't fail (back-compat for
  // tenant-only flows like cron jobs), but make the leak visible.
  if (safePersona <= 0) {
    try { console.warn(`[camofox] tenantUserId called without personaId for tenant ${safeTenant} — falling back to tenant-shared session jar (cross-persona bleed possible)`); } catch (_silentErr) { logSilentCatch("server/camofox-tool.ts", _silentErr); }
  }
  const personaSeg = safePersona > 0 ? `-p${safePersona}` : "";
  return `vc-tenant-${safeTenant}${personaSeg}${userIdSuffix ? `-${userIdSuffix}` : ""}`;
}

// R96.1+architect-CRITICAL-#2 fix: SSRF guard for the URL-accepting actions
// (open + navigate). Camofox runs the fetch from inside Railway's network,
// so an LLM-controlled url like http://169.254.169.254/, http://10.x.x.x/,
// or http://internal-service.railway.internal/ would happily resolve from
// the Camofox container even though our own VisionClaw server can't reach
// those. Reuse the hardened isSafeUrl + isSafeDns from structured-extraction
// (already used by the firecrawl/template-scrape paths). Returns the
// canonicalized URL on success, or a CamofoxResult error on rejection.
//
// RESIDUAL RISK (architect re-review): split-horizon DNS — the DNS lookup
// runs from VisionClaw's server, but the actual fetch runs inside the
// Camofox Railway container, which can resolve names differently (private
// service-mesh names, different upstream resolver, etc). Full mitigation
// requires the Camofox service itself to enforce the same SSRF check
// against the resolved IP just before connect(). Tracked as a follow-up;
// app-side check is correct defense-in-depth and blocks every literal-IP
// + public-DNS attack vector. The Railway internal hostname pattern
// (*.railway.internal) is explicitly blocked at the literal-string level
// in isSafeUrl so split-horizon resolution can't help an attacker reach
// neighbor services even via an alias.
async function safeBrowseUrl(action: CamofoxParams["action"], rawUrl: string): Promise<{ ok: true; url: string } | CamofoxResult> {
  const { isSafeUrl, isSafeDns } = await import("./structured-extraction");
  const lit = isSafeUrl(rawUrl);
  if (!lit.ok) {
    return { ok: false, action, engine: "camofox", error: `URL rejected by SSRF guard: ${lit.reason}` };
  }
  try {
    const u = new URL(rawUrl);
    const dns = await isSafeDns(u.hostname);
    if (!dns.ok) {
      return { ok: false, action, engine: "camofox", error: `URL rejected by SSRF guard: ${dns.reason}` };
    }
    return { ok: true, url: u.toString() };
  } catch (e: any) {
    return { ok: false, action, engine: "camofox", error: `URL parse failed: ${e?.message?.slice(0, 80)}` };
  }
}

export interface CamofoxParams {
  action:
    | "open"
    | "snapshot"
    | "navigate"
    | "click"
    | "type"
    | "scroll"
    | "screenshot"
    | "extract"
    | "list_tabs"
    | "close_tab"
    | "close_session";
  url?: string;
  ref?: string;
  text?: string;
  selector?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  schema?: Record<string, any>;
  tabId?: string;
  sessionKey?: string;
  userIdSuffix?: string;
  trace?: boolean;
  includeScreenshot?: boolean;
  _tenantId?: number;
  _personaId?: number;
}

export interface CamofoxResult {
  ok: boolean;
  action: string;
  tabId?: string;
  url?: string;
  title?: string;
  snapshot?: string;
  snapshotTruncated?: boolean;
  screenshotBase64?: string;
  data?: any;
  tabs?: any[];
  error?: string;
  engine: "camofox";
  note?: string;
}

export async function executeCamofoxAction(params: CamofoxParams): Promise<CamofoxResult> {
  const tenantId = params._tenantId;
  if (!tenantId) {
    return { ok: false, action: params.action, engine: "camofox", error: "Tenant context required for stealth_browse_camofox" };
  }
  if (!isCamofoxConfigured()) {
    return { ok: false, action: params.action, engine: "camofox", error: "Camofox is not configured. Set CAMOFOX_URL and CAMOFOX_ACCESS_KEY (or CAMOFOX_REQUIRE_AUTH=false to opt out)." };
  }
  const safeSuffix = sanitizeUserIdSuffix(params.userIdSuffix);
  const userId = tenantUserId(tenantId, params._personaId, safeSuffix);
  const sessionKey = sanitizeSessionKey(params.sessionKey);
  const u = encodeURIComponent(userId);
  const tab = params.tabId ? encodeURIComponent(params.tabId) : "";
  try {
    switch (params.action) {
      case "open": {
        if (!params.url) return { ok: false, action: "open", engine: "camofox", error: "url is required" };
        const safe = await safeBrowseUrl("open", params.url);
        if (!("url" in safe)) return safe;
        const body: any = { userId, sessionKey, url: safe.url };
        if (params.trace) body.trace = true;
        const res = await camoFetch(`/tabs`, { method: "POST", body: JSON.stringify(body) });
        return {
          ok: true, action: "open", engine: "camofox",
          tabId: res.tabId, url: res.url, title: res.title,
          snapshot: res.snapshot, snapshotTruncated: res.snapshotTruncated, data: res,
        };
      }
      case "snapshot": {
        if (!params.tabId) return { ok: false, action: "snapshot", engine: "camofox", error: "tabId is required" };
        const qs = `?userId=${u}${params.includeScreenshot ? "&includeScreenshot=true" : ""}`;
        const res = await camoFetch(`/tabs/${tab}/snapshot${qs}`, { method: "GET" });
        return {
          ok: true, action: "snapshot", engine: "camofox", tabId: params.tabId,
          url: res.url, title: res.title, snapshot: res.snapshot, snapshotTruncated: res.snapshotTruncated,
          screenshotBase64: res.screenshot, data: res,
        };
      }
      case "navigate": {
        if (!params.tabId) return { ok: false, action: "navigate", engine: "camofox", error: "tabId is required" };
        if (!params.url) return { ok: false, action: "navigate", engine: "camofox", error: "url is required" };
        const safe = await safeBrowseUrl("navigate", params.url);
        if (!("url" in safe)) return safe;
        const res = await camoFetch(`/tabs/${tab}/navigate`, {
          method: "POST", body: JSON.stringify({ userId, url: safe.url }),
        });
        return { ok: true, action: "navigate", engine: "camofox", tabId: params.tabId, url: res.url, title: res.title, snapshot: res.snapshot, data: res };
      }
      case "click": {
        if (!params.tabId) return { ok: false, action: "click", engine: "camofox", error: "tabId is required" };
        if (!params.ref && !params.selector) return { ok: false, action: "click", engine: "camofox", error: "ref or selector is required" };
        const body: any = { userId };
        if (params.ref) body.ref = params.ref;
        if (params.selector) body.selector = params.selector;
        const res = await camoFetch(`/tabs/${tab}/click`, { method: "POST", body: JSON.stringify(body) });
        return { ok: true, action: "click", engine: "camofox", tabId: params.tabId, snapshot: res.snapshot, data: res };
      }
      case "type": {
        if (!params.tabId) return { ok: false, action: "type", engine: "camofox", error: "tabId is required" };
        if (!params.ref && !params.selector) return { ok: false, action: "type", engine: "camofox", error: "ref or selector is required" };
        if (typeof params.text !== "string") return { ok: false, action: "type", engine: "camofox", error: "text is required" };
        const body: any = { userId, text: params.text };
        if (params.ref) body.ref = params.ref;
        if (params.selector) body.selector = params.selector;
        const res = await camoFetch(`/tabs/${tab}/type`, { method: "POST", body: JSON.stringify(body) });
        return { ok: true, action: "type", engine: "camofox", tabId: params.tabId, snapshot: res.snapshot, data: res };
      }
      case "scroll": {
        if (!params.tabId) return { ok: false, action: "scroll", engine: "camofox", error: "tabId is required" };
        const body: any = { userId, direction: params.direction || "down" };
        if (typeof params.amount === "number") body.amount = params.amount;
        const res = await camoFetch(`/tabs/${tab}/scroll`, { method: "POST", body: JSON.stringify(body) });
        return { ok: true, action: "scroll", engine: "camofox", tabId: params.tabId, snapshot: res.snapshot, data: res };
      }
      case "screenshot": {
        if (!params.tabId) return { ok: false, action: "screenshot", engine: "camofox", error: "tabId is required" };
        const res = await camoFetch(`/tabs/${tab}/screenshot?userId=${u}`, { method: "GET" });
        return {
          ok: true, action: "screenshot", engine: "camofox", tabId: params.tabId,
          screenshotBase64: res.screenshot || res.image || res.data, data: res,
        };
      }
      case "extract": {
        if (!params.tabId) return { ok: false, action: "extract", engine: "camofox", error: "tabId is required" };
        if (!params.schema || typeof params.schema !== "object") {
          return { ok: false, action: "extract", engine: "camofox", error: "schema (JSON Schema with x-ref hints) is required" };
        }
        const res = await camoFetch(`/tabs/${tab}/extract`, {
          method: "POST", body: JSON.stringify({ userId, schema: params.schema }),
        });
        return { ok: true, action: "extract", engine: "camofox", tabId: params.tabId, data: res };
      }
      case "list_tabs": {
        const res = await camoFetch(`/tabs?userId=${u}`, { method: "GET" });
        return { ok: true, action: "list_tabs", engine: "camofox", tabs: res.tabs || res, data: res };
      }
      case "close_tab": {
        if (!params.tabId) return { ok: false, action: "close_tab", engine: "camofox", error: "tabId is required" };
        const res = await camoFetch(`/tabs/${tab}?userId=${u}`, { method: "DELETE" });
        return { ok: true, action: "close_tab", engine: "camofox", tabId: params.tabId, data: res };
      }
      case "close_session": {
        const res = await camoFetch(`/sessions/${u}`, { method: "DELETE" });
        return { ok: true, action: "close_session", engine: "camofox", data: res };
      }
      default:
        return { ok: false, action: String(params.action), engine: "camofox", error: `Unknown action: ${params.action}` };
    }
  } catch (err: any) {
    logSilentCatch("server/camofox-tool.ts", err);
    return { ok: false, action: params.action, engine: "camofox", error: err?.message || String(err) };
  }
}
