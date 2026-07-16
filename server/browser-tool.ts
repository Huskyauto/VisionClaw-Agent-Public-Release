import fs from "fs";
import path from "path";
import crypto from "crypto";
import dns from "dns/promises";
import { EventEmitter } from "events";
import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";
import { uploadAndShare } from "./google-drive";
import { getClientForModel } from "./providers";

import { logSilentCatch } from "./lib/silent-catch";
const BROWSER_SCREENSHOTS_BASE = process.env.NODE_ENV === "production"
  ? "/tmp/browser-screenshots"
  : path.join(process.cwd(), "data", "browser-screenshots");

export const browserEvents = new EventEmitter();
browserEvents.setMaxListeners(50);

export interface BrowserLiveEvent {
  tenantId: number;
  type: "navigating" | "screenshot" | "clicking" | "typing" | "scrolling" | "browsing" | "analyzing";
  statusText: string;
  screenshotUrl?: string;
  screenshotBase64?: string;
  pageTitle?: string;
  pageUrl?: string;
  visionNarration?: string;
}

function emitBrowserLive(tenantId: number | undefined, type: BrowserLiveEvent["type"], statusText: string, extra?: Partial<BrowserLiveEvent>) {
  if (!tenantId) return;
  browserEvents.emit("live", { tenantId, type, statusText, ...extra } as BrowserLiveEvent);
}

async function geminiVisionNarrate(screenshotBase64: string, pageUrl: string, action: string): Promise<string> {
  const VISION_MODELS = ["gpt-5.6-sol", "gemini-3.5-flash"];
  for (const visionModel of VISION_MODELS) {
    try {
      const { client, actualModelId } = await getClientForModel(visionModel);
      const response = await client.chat.completions.create({
        model: actualModelId,
        max_completion_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are narrating an AI agent's browser actions for a live audience watching a big screen. The agent just performed this action: ${action} on ${pageUrl}. Describe what you see on this page in one or two short plain English sentences. Write exactly how a person would speak out loud. Do not use any special characters or formatting. No hashtags. No bullet points. No colons. No dashes. No quotation marks. No markdown. No technical syntax. Just simple natural spoken English describing what is on screen right now.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` },
              },
            ],
          },
        ],
      });
      const raw = response.choices?.[0]?.message?.content?.trim() || "";
      return raw.replace(/[#*_`~\[\](){}|<>:;—–\-"]/g, " ").replace(/\s{2,}/g, " ").trim();
    } catch (err: any) {
      console.log(`[browser-vision] ${visionModel} narration failed (non-blocking): ${err.message?.slice(0, 100)}`);
      continue;
    }
  }
  return "";
}

const narrationThrottleMap = new Map<number, number>();
const NARRATION_THROTTLE_MS = 4000;

async function captureAndNarrate(page: Page, tenantId: number | undefined, action: string) {
  if (!tenantId) return;
  const now = Date.now();
  const lastCall = narrationThrottleMap.get(tenantId) || 0;
  if (now - lastCall < NARRATION_THROTTLE_MS) return;
  narrationThrottleMap.set(tenantId, now);

  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 60 }) as Buffer;
    const base64 = buf.toString("base64");
    const thumb = `data:image/jpeg;base64,${base64}`;
    const title = await page.title().catch(() => "");
    const url = page.url();

    const tenantDir = `${tenantId}`;
    const screenshotDir = path.join(BROWSER_SCREENSHOTS_BASE, tenantDir);
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const filename = `auto-${Date.now()}.jpg`;
    const filepath = path.join(screenshotDir, filename);
    fs.writeFileSync(filepath, buf);
    const localUrl = `/api/browser/screenshots/${tenantDir}/${filename}`;

    emitBrowserLive(tenantId, "screenshot", `${action}: ${title}`, {
      screenshotUrl: localUrl,
      screenshotBase64: thumb,
      pageTitle: title,
      pageUrl: url,
    });

    geminiVisionNarrate(base64, url, action).then((narration) => {
      if (narration) {
        emitBrowserLive(tenantId, "analyzing", narration, {
          screenshotUrl: localUrl,
          pageTitle: title,
          pageUrl: url,
          visionNarration: narration,
        });
      }
    });
  } catch (err: any) {
    console.log(`[browser-vision] Auto-capture failed (non-blocking): ${err.message?.slice(0, 80)}`);
  }
}

const CONFIG_PATH = path.join(process.cwd(), "data", "browser-config.json");

export interface BrowserProfileConfig {
  cdpUrl: string;
  driver: "remote" | "extension" | "managed";
  color: string;
  apiKey?: string;
  label?: string;
}

export interface BrowserConfig {
  enabled: boolean;
  defaultProfile: string;
  headless: boolean;
  ssrfPolicy: {
    allowPrivateNetwork: boolean;
    hostnameAllowlist: string[];
    blockedHostnames: string[];
  };
  profiles: Record<string, BrowserProfileConfig>;
  screenshotQuality: number;
  navigationTimeout: number;
  maxContentLength: number;
  remoteCdpTimeoutMs: number;
  remoteCdpHandshakeTimeoutMs: number;
  maxSessionsPerTenant: number;
  maxActionsPerMinute: number;
  sessionIdleTimeoutMs: number;
  screenshotMaxAgeDays: number;
}

const DEFAULT_CONFIG: BrowserConfig = {
  enabled: false,
  defaultProfile: "remote",
  headless: true,
  ssrfPolicy: {
    allowPrivateNetwork: false,
    hostnameAllowlist: [],
    blockedHostnames: [],
  },
  profiles: {
    remote: {
      cdpUrl: "",
      driver: "remote",
      color: "#FF4500",
      label: "Remote Browser",
    },
  },
  screenshotQuality: 80,
  navigationTimeout: 30000,
  maxContentLength: 50000,
  remoteCdpTimeoutMs: 1500,
  remoteCdpHandshakeTimeoutMs: 3000,
  maxSessionsPerTenant: 3,
  maxActionsPerMinute: 30,
  sessionIdleTimeoutMs: 5 * 60 * 1000,
  screenshotMaxAgeDays: 1,
};

export function loadBrowserConfig(): BrowserConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        ssrfPolicy: { ...DEFAULT_CONFIG.ssrfPolicy, ...(parsed.ssrfPolicy || {}) },
        profiles: { ...DEFAULT_CONFIG.profiles, ...(parsed.profiles || {}) },
      };
    }
  } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  return { ...DEFAULT_CONFIG };
}

export function saveBrowserConfig(update: Partial<BrowserConfig>): BrowserConfig {
  const current = loadBrowserConfig();
  const merged: BrowserConfig = {
    ...current,
    ...update,
    ssrfPolicy: { ...current.ssrfPolicy, ...(update.ssrfPolicy || {}) },
    profiles: update.profiles !== undefined
      ? { ...current.profiles, ...update.profiles }
      : current.profiles,
  };
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// ─── Auto-configure from environment ──────────────────────

export function autoConfigureFromEnv(): void {
  const config = loadBrowserConfig();
  let changed = false;

  const browserlessKey = process.env.BROWSERLESS_API_KEY;
  if (browserlessKey) {
    const profile = config.profiles["browserless"];
    if (!profile) {
      config.profiles["browserless"] = {
        cdpUrl: `wss://chrome.browserless.io?token=${browserlessKey}`,
        driver: "remote",
        color: "#4A90D9",
        label: "Browserless Cloud",
      };
      if (!config.defaultProfile || config.defaultProfile === "remote") {
        config.defaultProfile = "browserless";
      }
      config.enabled = true;
      changed = true;
      console.log("[browser] Auto-configured Browserless from BROWSERLESS_API_KEY");
    } else if (!profile.cdpUrl || !profile.cdpUrl.includes(browserlessKey)) {
      config.profiles["browserless"].cdpUrl = `wss://chrome.browserless.io?token=${browserlessKey}`;
      changed = true;
      console.log("[browser] Updated Browserless CDP URL from env");
    }
  }

  const rayobrowseUrl = process.env.RAYOBROWSE_URL;
  if (rayobrowseUrl) {
    let wsUrl: string;
    try {
      const parsed = new URL(rayobrowseUrl);
      if (!["ws:", "wss:", "http:", "https:"].includes(parsed.protocol)) {
        console.warn("[browser] RAYOBROWSE_URL has unsupported protocol:", parsed.protocol);
      } else {
        if (parsed.protocol === "http:") parsed.protocol = "ws:";
        if (parsed.protocol === "https:") parsed.protocol = "wss:";
        if (!parsed.pathname.includes("/connect")) {
          parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/connect";
        }
        if (!parsed.searchParams.has("headless")) parsed.searchParams.set("headless", "true");
        if (!parsed.searchParams.has("os")) parsed.searchParams.set("os", "windows");
        wsUrl = parsed.toString();

        const existing = config.profiles["rayobrowse"];
        if (!existing) {
          config.profiles["rayobrowse"] = {
            cdpUrl: wsUrl,
            driver: "remote",
            color: "#00D4FF",
            label: "Rayobrowse Stealth",
          };
          config.enabled = true;
          changed = true;
          console.log("[browser] Auto-configured Rayobrowse stealth browser from RAYOBROWSE_URL");
        } else if (existing.cdpUrl !== wsUrl) {
          config.profiles["rayobrowse"].cdpUrl = wsUrl;
          changed = true;
          console.log("[browser] Updated Rayobrowse CDP URL from env");
        }
      }
    } catch (e: any) {
      console.warn("[browser] Invalid RAYOBROWSE_URL:", e.message);
    }
  } else if (config.profiles["rayobrowse"]) {
    delete config.profiles["rayobrowse"];
    if (config.defaultProfile === "rayobrowse") {
      config.defaultProfile = config.profiles["browserless"] ? "browserless" : "remote";
    }
    changed = true;
    console.log("[browser] Removed stale Rayobrowse profile (RAYOBROWSE_URL unset)");
  }

  if (changed) saveBrowserConfig(config);
}

export function getRayobrowseStatus(): { configured: boolean; url?: string; label?: string } {
  const config = loadBrowserConfig();
  const profile = config.profiles["rayobrowse"];
  if (!profile?.cdpUrl) return { configured: false };
  return { configured: true, url: profile.cdpUrl.replace(/\?.*$/, ""), label: profile.label };
}

// ─── Profile CRUD ──────────────────────────────────────────

export function createProfile(name: string, profile: Partial<BrowserProfileConfig>): BrowserConfig {
  const config = loadBrowserConfig();
  if (config.profiles[name]) throw new Error(`Profile "${name}" already exists`);
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error("Profile name must be alphanumeric (with hyphens/underscores)");
  if (Object.keys(config.profiles).length >= 10) throw new Error("Maximum 10 profiles allowed");

  config.profiles[name] = {
    cdpUrl: profile.cdpUrl || "",
    driver: profile.driver || "remote",
    color: profile.color || "#808080",
    label: profile.label || name,
    apiKey: profile.apiKey,
  };

  return saveBrowserConfig({ profiles: config.profiles });
}

export function updateProfile(name: string, update: Partial<BrowserProfileConfig>): BrowserConfig {
  const config = loadBrowserConfig();
  if (!config.profiles[name]) throw new Error(`Profile "${name}" not found`);
  config.profiles[name] = { ...config.profiles[name], ...update };
  return saveBrowserConfig({ profiles: config.profiles });
}

export function deleteProfile(name: string): BrowserConfig {
  const config = loadBrowserConfig();
  if (!config.profiles[name]) throw new Error(`Profile "${name}" not found`);
  if (config.defaultProfile === name) throw new Error(`Cannot delete the default profile "${name}". Switch default first.`);

  for (const [key, session] of tenantSessions.entries()) {
    if (key.endsWith(`:${name}`)) {
      stopLiveRefresh(session.tenantId);
      try { session.context.close(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
      tenantSessions.delete(key);
    }
  }

  delete config.profiles[name];
  return saveBrowserConfig({ profiles: config.profiles });
}

// ─── SSRF Protection ───────────────────────────────────────

const BLOCKED_SCHEMES = ["file:", "data:", "javascript:", "ftp:", "gopher:"];

const BLOCKED_HOSTNAMES_DEFAULT = [
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.google",
  "100.100.100.200",
];

function normalizeIpv4(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length === 1) {
    const num = parseInt(parts[0], 10);
    if (isNaN(num) || num < 0 || num > 0xFFFFFFFF) return null;
    return `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
  }
  if (parts.length === 2) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (isNaN(a) || isNaN(b) || a > 255 || b > 0xFFFFFF) return null;
    return `${a}.${(b >>> 16) & 0xFF}.${(b >>> 8) & 0xFF}.${b & 0xFF}`;
  }
  if (parts.length === 3) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    const c = parseInt(parts[2], 10);
    if (isNaN(a) || isNaN(b) || isNaN(c) || a > 255 || b > 255 || c > 0xFFFF) return null;
    return `${a}.${b}.${(c >>> 8) & 0xFF}.${c & 0xFF}`;
  }
  if (parts.length === 4) {
    const nums = parts.map(p => {
      if (p.startsWith("0x") || p.startsWith("0X")) return parseInt(p, 16);
      if (p.startsWith("0") && p.length > 1) return parseInt(p, 8);
      return parseInt(p, 10);
    });
    if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
    return nums.join(".");
  }
  return null;
}

export function isPrivateIpNormalized(ip: string): boolean {
  if (ip === "0.0.0.0") return true;

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    if (ip === "::1" || ip === "::") return true;
    // fc00::/7 unique-local (fc, fd) + fe80::/10 link-local (fe80–febf, i.e.
    // first hextet fe8*/fe9*/fea*/feb*) + ff00::/8 multicast. The old
    // `startsWith("fe80")` missed fe90::/fea0::/febf:: which are equally
    // link-local and SSRF-reachable; ff* added for parity with
    // structured-extraction.ts isPrivateIPv6. (No global unicast starts with
    // ff; v4-mapped ::ffff:* starts with "::" so it's handled below.)
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("ff") || /^fe[89ab]/i.test(ip)) return true;
    if (ip.includes("::ffff:")) {
      const mapped = ip.split("::ffff:")[1];
      if (mapped) return isPrivateIpNormalized(mapped);
    }
    return false;
  }

  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
  return false;
}

function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (BLOCKED_SCHEMES.includes(parsed.protocol)) return true;

    let hostname = parsed.hostname;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }

    if (hostname === "localhost") return true;
    if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost")) return true;
    if (BLOCKED_HOSTNAMES_DEFAULT.includes(hostname)) return true;

    const normalized = normalizeIpv4(hostname);
    if (normalized) {
      return isPrivateIpNormalized(normalized);
    }

    if (isPrivateIpNormalized(hostname)) return true;

    return false;
  } catch {
    return true;
  }
}

function isUrlAllowed(url: string, config: BrowserConfig): boolean {
  try {
    const parsed = new URL(url);
    if (BLOCKED_SCHEMES.includes(parsed.protocol)) return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  } catch {
    return false;
  }

  if (config.ssrfPolicy.blockedHostnames?.length > 0) {
    try {
      const hostname = new URL(url).hostname;
      if (config.ssrfPolicy.blockedHostnames.some(b => hostname === b || hostname.endsWith(`.${b}`))) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (config.ssrfPolicy.allowPrivateNetwork) return true;

  if (isPrivateUrl(url)) {
    const hostname = new URL(url).hostname;
    if (config.ssrfPolicy.hostnameAllowlist.length > 0) {
      return config.ssrfPolicy.hostnameAllowlist.some(pattern => {
        if (pattern.startsWith("*.")) {
          return hostname.endsWith(pattern.slice(1)) || hostname === pattern.slice(2);
        }
        return hostname === pattern;
      });
    }
    return false;
  }
  return true;
}

async function isUrlAllowedWithDns(url: string, config: BrowserConfig): Promise<boolean> {
  if (!isUrlAllowed(url, config)) return false;

  if (config.ssrfPolicy.allowPrivateNetwork) return true;

  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");

    const normalized = normalizeIpv4(hostname);
    if (normalized) {
      return !isPrivateIpNormalized(normalized);
    }
    if (isPrivateIpNormalized(hostname)) return false;

    let resolved = false;
    try {
      const addresses = await dns.resolve4(hostname);
      resolved = true;
      for (const addr of addresses) {
        if (isPrivateIpNormalized(addr)) return false;
      }
    } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }

    try {
      const addresses = await dns.resolve6(hostname);
      resolved = true;
      for (const addr of addresses) {
        if (isPrivateIpNormalized(addr)) return false;
      }
    } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }

    if (!resolved) return false;
  } catch {
    return false;
  }

  return true;
}

function sanitizeSelector(selector: string): string {
  if (selector.length > 500) throw new Error("Selector too long (max 500 chars)");
  const dangerous = /javascript\s*:/i;
  if (dangerous.test(selector)) throw new Error("Selector contains disallowed pattern");
  return selector;
}

async function validatePageUrlAfterAction(page: Page, config: BrowserConfig): Promise<string | null> {
  const currentUrl = page.url();
  if (currentUrl && currentUrl !== "about:blank" && !(await isUrlAllowedWithDns(currentUrl, config))) {
    try { await page.goBack({ timeout: 5000 }); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
    return `Navigation to ${new URL(currentUrl).hostname} was blocked by security policy.`;
  }
  return null;
}

// ─── Request-level SSRF guard (closes the page.goto TOCTOU, 2026-07-08) ────
//
// The pre-navigation isUrlAllowedWithDns() check validates a URL BEFORE the
// remote Browserless session navigates — a DNS-rebinding host or a redirect
// chain could still steer the browser to a private/internal address AFTER
// the check (time-of-check/time-of-use). This guard intercepts every request
// the page issues, inside the CDP session itself:
//   • ALL requests (navigations + subresources): abort on literal private-IP
//     hosts, blocked hostnames, and non-http(s) schemes (data/blob/about pass).
//   • NAVIGATION requests (initial goto, every redirect hop, client-side
//     navigations, frames): full DNS-revalidated policy check, so a redirect
//     to a rebinding host is aborted at the hop where it appears.
// Verdicts are cached per-hostname for a short TTL to keep per-request DNS
// overhead off the hot path (the browser caches DNS on the same order anyway).
// Failure posture: navigation requests fail CLOSED (abort on guard error);
// subresource guard errors fail open (a broken image is not a security event).

const ssrfGuardedPages = new WeakSet<Page>();
const ssrfDnsVerdictCache = new Map<string, { allowed: boolean; expires: number }>();
const SSRF_DNS_VERDICT_TTL_MS = 30_000;
const SSRF_DNS_VERDICT_CACHE_MAX = 500;

async function isNavUrlAllowedCached(url: string, config: BrowserConfig): Promise<boolean> {
  const hostname = new URL(url).hostname.toLowerCase();
  const now = Date.now();
  const hit = ssrfDnsVerdictCache.get(hostname);
  if (hit && hit.expires > now) return hit.allowed;
  const allowed = await isUrlAllowedWithDns(url, config);
  if (ssrfDnsVerdictCache.size >= SSRF_DNS_VERDICT_CACHE_MAX) {
    for (const [k, v] of ssrfDnsVerdictCache) {
      if (v.expires <= now) ssrfDnsVerdictCache.delete(k);
    }
    if (ssrfDnsVerdictCache.size >= SSRF_DNS_VERDICT_CACHE_MAX) ssrfDnsVerdictCache.clear();
  }
  ssrfDnsVerdictCache.set(hostname, { allowed, expires: now + SSRF_DNS_VERDICT_TTL_MS });
  return allowed;
}

function hostnameIsLiteralPrivateIp(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const normalized = normalizeIpv4(bare);
  if (normalized && isPrivateIpNormalized(normalized)) return true;
  return isPrivateIpNormalized(bare);
}

export async function attachSsrfRequestGuard(page: Page): Promise<void> {
  if (ssrfGuardedPages.has(page)) return;
  const config = loadBrowserConfig();
  if (config.ssrfPolicy.allowPrivateNetwork) {
    ssrfGuardedPages.add(page);
    return;
  }
  try {
    await page.setRequestInterception(true);
  } catch (err: any) {
    // Could not arm interception (page already closed / CDP hiccup). The
    // pre-navigation + post-action URL checks remain; log LOUD so this
    // never degrades silently.
    console.warn(`[browser] SSRF request guard could not attach: ${err?.message?.slice(0, 120)}`);
    return;
  }
  ssrfGuardedPages.add(page);
  page.on("request", (req) => {
    void (async () => {
      const abort = async () => { try { await req.abort("blockedbyclient"); } catch (_e) { logSilentCatch("server/browser-tool.ts", _e); } };
      const allow = async () => { try { await req.continue(); } catch (_e) { logSilentCatch("server/browser-tool.ts", _e); } };
      try {
        const url = req.url();
        if (/^(data|blob|about):/i.test(url)) return void (await allow());
        if (!/^https?:\/\//i.test(url)) return void (await abort());
        const hostname = new URL(url).hostname.toLowerCase();
        if (hostnameIsLiteralPrivateIp(hostname)) return void (await abort());
        if (config.ssrfPolicy.blockedHostnames?.some(b => hostname === b || hostname.endsWith(`.${b}`))) {
          return void (await abort());
        }
        if (req.isNavigationRequest()) {
          if (!(await isNavUrlAllowedCached(url, config))) {
            console.warn(`[browser] SSRF guard aborted navigation to ${hostname} (post-check re-validation)`);
            return void (await abort());
          }
        }
        return void (await allow());
      } catch (err: any) {
        logSilentCatch("server/browser-tool.ts", err);
        // Fail CLOSED for navigations, OPEN for subresources.
        let isNav = false;
        try { isNav = req.isNavigationRequest(); } catch (_e) { isNav = true; }
        if (isNav) await abort(); else await allow();
      }
    })();
  });
}

// ─── Tenant Session Management ─────────────────────────────

interface TenantBrowserSession {
  tenantId: number;
  profileName: string;
  browser: Browser;
  context: BrowserContext;
  createdAt: number;
  lastActivity: number;
  actionCount: number;
  actionTimestamps: number[];
}

const tenantSessions = new Map<string, TenantBrowserSession>();

let sharedBrowser: Browser | null = null;
let sharedBrowserProfile: string | null = null;

function sessionKey(tenantId: number, profileName: string): string {
  return `${tenantId}:${profileName}`;
}

function getSessionCountForTenant(tenantId: number): number {
  let count = 0;
  for (const [key] of tenantSessions) {
    if (key.startsWith(`${tenantId}:`)) count++;
  }
  return count;
}

function getTenantActionCount(tenantId: number): number {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  let total = 0;
  for (const [key, session] of tenantSessions) {
    if (key.startsWith(`${tenantId}:`)) {
      session.actionTimestamps = session.actionTimestamps.filter(t => t > oneMinuteAgo);
      total += session.actionTimestamps.length;
    }
  }
  return total;
}

function checkTenantRateLimit(tenantId: number, config: BrowserConfig): boolean {
  return getTenantActionCount(tenantId) < config.maxActionsPerMinute;
}

export function checkTenantRateLimitExport(tenantId: number): boolean {
  const config = loadBrowserConfig();
  return checkTenantRateLimit(tenantId, config);
}

function recordAction(session: TenantBrowserSession): void {
  session.lastActivity = Date.now();
  session.actionCount++;
  session.actionTimestamps.push(Date.now());
}

async function getOrCreateSharedBrowser(profileName: string): Promise<Browser> {
  const config = loadBrowserConfig();
  const name = profileName || config.defaultProfile;
  const profile = config.profiles[name];

  if (!profile?.cdpUrl) {
    throw new Error(`No browser service configured. Set a CDP URL in Settings → Browser Tool, or add BROWSERLESS_API_KEY to your environment secrets.`);
  }

  if (sharedBrowser && sharedBrowserProfile === name) {
    try {
      await sharedBrowser.version();
      return sharedBrowser;
    } catch {
      sharedBrowser = null;
      sharedBrowserProfile = null;
    }
  }

  if (sharedBrowser) {
    try { await sharedBrowser.disconnect(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
    sharedBrowser = null;
    sharedBrowserProfile = null;
  }

  let cdpUrl = profile.cdpUrl;
  const isWebSocket = cdpUrl.startsWith("ws://") || cdpUrl.startsWith("wss://");

  if (isWebSocket && cdpUrl.includes("browserless.io")) {
    const sep = cdpUrl.includes("?") ? "&" : "?";
    if (!cdpUrl.includes("stealth")) cdpUrl += `${sep}stealth=true`;
    if (!cdpUrl.includes("blockAds")) cdpUrl += `&blockAds=true`;
  }

  const maxRetries = 3;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (isWebSocket) {
        sharedBrowser = await puppeteer.connect({
          browserWSEndpoint: cdpUrl,
          defaultViewport: { width: 1366, height: 768 },
          protocolTimeout: 15000,
        });
      } else {
        sharedBrowser = await puppeteer.connect({
          browserURL: cdpUrl,
          defaultViewport: { width: 1366, height: 768 },
          protocolTimeout: 15000,
        });
      }
      sharedBrowserProfile = name;
      console.log(`[browser] Connected to "${name}" via ${isWebSocket ? "WebSocket" : "HTTP"} CDP${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      return sharedBrowser;
    } catch (err: any) {
      lastError = err;
      console.warn(`[browser] Connection attempt ${attempt}/${maxRetries} to "${name}" failed: ${err.message?.slice(0, 100)}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw new Error(`Could not connect to browser service after ${maxRetries} attempts. Check your browser profile settings and ensure the service is running. Last error: ${lastError?.message?.slice(0, 100)}`);
}

async function getTenantSession(tenantId: number, profileName?: string): Promise<TenantBrowserSession> {
  const config = loadBrowserConfig();
  const name = profileName || config.defaultProfile;
  const key = sessionKey(tenantId, name);

  const existing = tenantSessions.get(key);
  if (existing) {
    try {
      const pages = await existing.context.pages();
      if (pages) {
        existing.lastActivity = Date.now();
        return existing;
      }
    } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
    tenantSessions.delete(key);
  }

  if (getSessionCountForTenant(tenantId) >= config.maxSessionsPerTenant) {
    throw new Error(`You've reached the maximum of ${config.maxSessionsPerTenant} simultaneous browser sessions. Close an existing session first.`);
  }

  const browser = await getOrCreateSharedBrowser(name);
  const context = await browser.createBrowserContext();

  const session: TenantBrowserSession = {
    tenantId,
    profileName: name,
    browser,
    context,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    actionCount: 0,
    actionTimestamps: [],
  };

  tenantSessions.set(key, session);
  console.log(`[browser] Created session for tenant ${tenantId} (profile: ${name})`);
  return session;
}

const STEALTH_SCRIPTS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
  ]});
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = function(params) {
    if (params.name === 'notifications') return Promise.resolve({ state: 'denied', onchange: null });
    return originalQuery.call(this, params);
  };
  Object.defineProperty(navigator.connection || {}, 'rtt', { get: () => 50 });
`;

function humanDelay(min = 80, max = 250): Promise<void> {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min)) + min));
}

async function applyStealthToPage(page: Page): Promise<void> {
  try {
    await page.evaluateOnNewDocument(STEALTH_SCRIPTS);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });
  } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  // Every page prepared for use gets the request-level SSRF guard —
  // attached OUTSIDE the stealth try/catch so a stealth hiccup can't skip it.
  await attachSsrfRequestGuard(page);
}

async function getPageForSession(session: TenantBrowserSession, tabIndex?: number): Promise<Page> {
  const pages = await session.context.pages();
  if (tabIndex !== undefined) {
    if (tabIndex < 0 || tabIndex >= pages.length) {
      throw new Error(`Tab ${tabIndex} doesn't exist. You have ${pages.length} tab(s) open (0-${pages.length - 1}).`);
    }
    // Pages can enter the context without going through our newPage path
    // (e.g. target=_blank popups opened by the site) — guard is idempotent.
    await attachSsrfRequestGuard(pages[tabIndex]);
    return pages[tabIndex];
  }
  if (pages.length === 0) {
    const page = await session.context.newPage();
    await applyStealthToPage(page);
    return page;
  }
  await attachSsrfRequestGuard(pages[0]);
  return pages[0];
}

// ─── Live Screenshot Refresh ────────────────────────────────

const liveRefreshIntervals = new Map<number, NodeJS.Timeout>();
const liveRefreshLocks = new Map<number, boolean>();
const liveRefreshErrors = new Map<number, number>();
const LIVE_REFRESH_MS = 2000;
const LIVE_REFRESH_MAX_ERRORS = 10;

function startLiveRefresh(tenantId: number) {
  if (liveRefreshIntervals.has(tenantId)) return;
  liveRefreshErrors.set(tenantId, 0);

  const interval = setInterval(async () => {
    if (liveRefreshLocks.get(tenantId)) return;
    liveRefreshLocks.set(tenantId, true);
    try {
      if (!liveRefreshIntervals.has(tenantId)) return;

      let session: TenantBrowserSession | null = null;
      for (const [key, s] of tenantSessions) {
        if (key.startsWith(`${tenantId}:`)) { session = s; break; }
      }
      if (!session) { stopLiveRefresh(tenantId); return; }

      const pages = await session.context.pages();
      const page = pages[0];
      if (!page) { stopLiveRefresh(tenantId); return; }

      const buf = await page.screenshot({ type: "jpeg", quality: 40 }) as Buffer;
      const thumb = `data:image/jpeg;base64,${buf.toString("base64")}`;
      const title = await page.title().catch(() => "");
      const url = await page.url();
      emitBrowserLive(tenantId, "screenshot", title || "Live view", { screenshotBase64: thumb, pageTitle: title, pageUrl: url });
      liveRefreshErrors.set(tenantId, 0);
    } catch (err: any) {
      const errCount = (liveRefreshErrors.get(tenantId) || 0) + 1;
      liveRefreshErrors.set(tenantId, errCount);
      console.log(`[browser-live] Refresh screenshot failed (${errCount}/${LIVE_REFRESH_MAX_ERRORS}): ${err.message?.slice(0, 80)}`);
      if (errCount >= LIVE_REFRESH_MAX_ERRORS) {
        console.log(`[browser-live] Too many refresh errors for tenant ${tenantId} — stopping`);
        stopLiveRefresh(tenantId);
        return;
      }
    } finally {
      if (liveRefreshIntervals.has(tenantId)) {
        liveRefreshLocks.set(tenantId, false);
      }
    }
  }, LIVE_REFRESH_MS);

  liveRefreshIntervals.set(tenantId, interval);
}

function stopLiveRefresh(tenantId: number) {
  const interval = liveRefreshIntervals.get(tenantId);
  if (interval) {
    clearInterval(interval);
    liveRefreshIntervals.delete(tenantId);
    liveRefreshLocks.delete(tenantId);
    liveRefreshErrors.delete(tenantId);
  }
}

// ─── Session Cleanup ────────────────────────────────────────

let cleanupInterval: NodeJS.Timeout | null = null;

export function startSessionCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(async () => {
    const config = loadBrowserConfig();
    const now = Date.now();
    for (const [key, session] of tenantSessions.entries()) {
      if (now - session.lastActivity > config.sessionIdleTimeoutMs) {
        console.log(`[browser] Closing idle session for tenant ${session.tenantId} (idle ${Math.floor((now - session.lastActivity) / 1000)}s)`);
        try { await session.context.close(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
        stopLiveRefresh(session.tenantId);
        tenantSessions.delete(key);
        tenantSomMaps.delete(somMapKey(session.tenantId));
        resetVisionState(session.tenantId);
        clearActionMemory(session.tenantId);
      }
    }
  }, 30_000);
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

// ─── Screenshot Pruning ─────────────────────────────────────

let pruneInterval: NodeJS.Timeout | null = null;

export function startScreenshotPruning(): void {
  if (pruneInterval) return;
  pruneOldScreenshots();
  pruneInterval = setInterval(() => {
    pruneOldScreenshots();
  }, 60 * 60 * 1000);
}

export function pruneOldScreenshots(): void {
  const config = loadBrowserConfig();
  const baseDir = BROWSER_SCREENSHOTS_BASE;
  if (!fs.existsSync(baseDir)) return;

  const maxAge = config.screenshotMaxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  function pruneDir(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          pruneDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".png") || entry.name.endsWith(".pdf"))) {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAge) {
            try { fs.unlinkSync(fullPath); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
          }
        }
      }
    } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  }

  pruneDir(baseDir);
}

// ─── Connection Health Check ───────────────────────────────

export async function checkConnectionHealth(profileName?: string): Promise<{
  profile: string;
  reachable: boolean;
  connected: boolean;
  version?: string;
  tabCount?: number;
  activeSessions?: number;
  uptime?: number;
  error?: string;
}> {
  const config = loadBrowserConfig();
  const name = profileName || config.defaultProfile;
  const profile = config.profiles[name];

  if (!profile?.cdpUrl) {
    return { profile: name, reachable: false, connected: false, error: "No CDP URL configured" };
  }

  const activeSessions = tenantSessions.size;

  const cdpUrl = profile.cdpUrl;
  const isWebSocket = cdpUrl.startsWith("ws://") || cdpUrl.startsWith("wss://");

  if (!isWebSocket) {
    try {
      const resp = await fetch(`${cdpUrl.replace(/\/+$/, "")}/json/version`, {
        signal: AbortSignal.timeout(config.remoteCdpTimeoutMs),
      });
      if (!resp.ok) {
        return { profile: name, reachable: false, connected: false, activeSessions, error: `HTTP ${resp.status}` };
      }
      const data = await resp.json();

      if (sharedBrowser && sharedBrowserProfile === name) {
        try {
          const version = await sharedBrowser.version();
          return { profile: name, reachable: true, connected: true, version, activeSessions };
        } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
      }

      return {
        profile: name, reachable: true, connected: false, activeSessions,
        version: data["Browser"] || data.browser || "Unknown",
      };
    } catch (err: any) {
      return { profile: name, reachable: false, connected: false, activeSessions, error: err.message };
    }
  }

  if (sharedBrowser && sharedBrowserProfile === name) {
    try {
      const version = await sharedBrowser.version();
      return { profile: name, reachable: true, connected: true, version, activeSessions };
    } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  }

  try {
    const { default: puppeteer } = await import("puppeteer-core");
    const probeBrowser = await puppeteer.connect({
      browserWSEndpoint: cdpUrl,
      protocolTimeout: config.remoteCdpTimeoutMs,
    });
    const version = await probeBrowser.version();
    probeBrowser.disconnect();
    return { profile: name, reachable: true, connected: false, version, activeSessions };
  } catch (err: any) {
    return { profile: name, reachable: false, connected: false, activeSessions, error: `WebSocket probe failed: ${err.message}` };
  }
}

// ─── Status ────────────────────────────────────────────────

export function isBrowserEnabled(): boolean {
  const config = loadBrowserConfig();
  if (!config.enabled) return false;
  const profile = config.profiles[config.defaultProfile];
  return !!profile?.cdpUrl;
}

export function getBrowserStatus(): {
  enabled: boolean;
  connected: boolean;
  profile: string;
  cdpUrl: string;
  profiles: Array<{ name: string; driver: string; color: string; label?: string; hasCdpUrl: boolean }>;
  activeSessions: number;
  sessionsByTenant: Record<number, number>;
} {
  const config = loadBrowserConfig();
  const profile = config.profiles[config.defaultProfile];

  const sessionsByTenant: Record<number, number> = {};
  for (const [, session] of tenantSessions) {
    sessionsByTenant[session.tenantId] = (sessionsByTenant[session.tenantId] || 0) + 1;
  }

  return {
    enabled: config.enabled,
    connected: !!sharedBrowser && !!sharedBrowserProfile,
    profile: config.defaultProfile,
    cdpUrl: profile?.cdpUrl ? profile.cdpUrl.replace(/token=[^&]+/, "token=***").replace(/apiKey=[^&]+/, "apiKey=***") : "",
    profiles: Object.entries(config.profiles).map(([name, p]) => ({
      name,
      driver: p.driver,
      color: p.color,
      label: p.label,
      hasCdpUrl: !!p.cdpUrl,
    })),
    activeSessions: tenantSessions.size,
    sessionsByTenant,
  };
}

// ─── Tab Management ─────────────────────────────────────────

export async function listTabs(profileName?: string, tenantId?: number): Promise<any> {
  if (tenantId) {
    const session = await getTenantSession(tenantId, profileName);
    recordAction(session);
    const pages = await session.context.pages();
    const tabs = await Promise.all(pages.map(async (p, i) => ({
      index: i, url: p.url(), title: await p.title().catch(() => ""),
    })));
    return { success: true, count: tabs.length, tabs };
  }
  const browser = await getOrCreateSharedBrowser(profileName || loadBrowserConfig().defaultProfile);
  const pages = await browser.pages();
  const tabs = await Promise.all(pages.map(async (p, i) => ({
    index: i, url: p.url(), title: await p.title().catch(() => ""),
  })));
  return { success: true, count: tabs.length, tabs };
}

export async function openTab(url: string, profileName?: string, tenantId?: number): Promise<any> {
  const config = loadBrowserConfig();
  if (!(await isUrlAllowedWithDns(url, config))) {
    return { success: false, error: "That URL is blocked by the security policy. Only public websites are allowed." };
  }
  if (tenantId) {
    const session = await getTenantSession(tenantId, profileName);
    recordAction(session);
    const page = await session.context.newPage();
    await applyStealthToPage(page);
    await page.goto(url, { waitUntil: "networkidle2", timeout: config.navigationTimeout });
    const redirectErr = await validatePageUrlAfterAction(page, config);
    if (redirectErr) { await page.close(); return { success: false, error: redirectErr }; }
    const title = await page.title();
    const pages = await session.context.pages();
    return { success: true, url: page.url(), title, tabIndex: pages.length - 1 };
  }
  const browser = await getOrCreateSharedBrowser(profileName || config.defaultProfile);
  const page = await browser.newPage();
  await applyStealthToPage(page);
  await page.goto(url, { waitUntil: "networkidle2", timeout: config.navigationTimeout });
  const redirectErr = await validatePageUrlAfterAction(page, config);
  if (redirectErr) { await page.close(); return { success: false, error: redirectErr }; }
  const title = await page.title();
  const pages = await browser.pages();
  return { success: true, url: page.url(), title, tabIndex: pages.length - 1 };
}

export async function focusTab(index: number, profileName?: string, tenantId?: number): Promise<any> {
  if (tenantId) {
    const session = await getTenantSession(tenantId, profileName);
    recordAction(session);
    const pages = await session.context.pages();
    if (index < 0 || index >= pages.length) {
      return { success: false, error: `Tab ${index} doesn't exist. You have ${pages.length} tab(s) open.` };
    }
    await pages[index].bringToFront();
    return { success: true, index, url: pages[index].url(), title: await pages[index].title() };
  }
  const browser = await getOrCreateSharedBrowser(profileName || loadBrowserConfig().defaultProfile);
  const pages = await browser.pages();
  if (index < 0 || index >= pages.length) {
    return { success: false, error: `Tab ${index} out of range (0-${pages.length - 1})` };
  }
  await pages[index].bringToFront();
  return { success: true, index, url: pages[index].url(), title: await pages[index].title() };
}

export async function closeTab(index: number, profileName?: string, tenantId?: number): Promise<any> {
  if (tenantId) {
    const session = await getTenantSession(tenantId, profileName);
    recordAction(session);
    const pages = await session.context.pages();
    if (index < 0 || index >= pages.length) {
      return { success: false, error: `Tab ${index} doesn't exist.` };
    }
    if (pages.length <= 1) {
      return { success: false, error: "Can't close the last tab. Navigate to a different page instead." };
    }
    const url = pages[index].url();
    await pages[index].close();
    return { success: true, closedIndex: index, closedUrl: url, remainingTabs: pages.length - 1 };
  }
  const browser = await getOrCreateSharedBrowser(profileName || loadBrowserConfig().defaultProfile);
  const pages = await browser.pages();
  if (index < 0 || index >= pages.length) return { success: false, error: `Tab ${index} out of range` };
  if (pages.length <= 1) return { success: false, error: "Cannot close the last tab" };
  const url = pages[index].url();
  await pages[index].close();
  return { success: true, closedIndex: index, closedUrl: url, remainingTabs: pages.length - 1 };
}

export async function getPageSnapshot(index?: number, profileName?: string, tenantId?: number): Promise<any> {
  const config = loadBrowserConfig();
  let page: Page;

  if (tenantId) {
    const session = await getTenantSession(tenantId, profileName);
    page = await getPageForSession(session, index);
    recordAction(session);
  } else {
    const browser = await getOrCreateSharedBrowser(profileName || config.defaultProfile);
    const pages = await browser.pages();
    page = index !== undefined ? pages[index] : pages[0];
  }

  if (!page) return { success: false, error: "No page available" };

  const snapshot = await page.evaluate(`
    (function() {
      function walk(node, depth) {
        if (depth > 6) return "";
        var tag = node.tagName ? node.tagName.toLowerCase() : "";
        if (!tag || ["script", "style", "noscript", "svg", "path"].indexOf(tag) !== -1) return "";
        var parts = [];
        var indent = "  ".repeat(depth);
        var attrs = [];
        var attrNames = ["id", "role", "aria-label", "href", "type", "name", "placeholder", "value", "data-testid"];
        for (var i = 0; i < attrNames.length; i++) {
          var val = node.getAttribute(attrNames[i]);
          if (val) attrs.push(attrNames[i] + '="' + val.slice(0, 100) + '"');
        }
        var cls = node.getAttribute("class");
        if (cls) attrs.push('class="' + cls.split(" ").slice(0, 3).join(" ") + '"');
        var attrStr = attrs.length ? " " + attrs.join(" ") : "";
        var textContent = Array.from(node.childNodes)
          .filter(function(n) { return n.nodeType === 3; })
          .map(function(n) { return (n.textContent || "").trim(); })
          .filter(Boolean)
          .join(" ")
          .slice(0, 100);
        if (textContent) {
          parts.push(indent + "<" + tag + attrStr + ">" + textContent + "</" + tag + ">");
        } else if (node.children.length > 0) {
          parts.push(indent + "<" + tag + attrStr + ">");
          var children = Array.from(node.children).slice(0, 20);
          for (var j = 0; j < children.length; j++) {
            var childStr = walk(children[j], depth + 1);
            if (childStr) parts.push(childStr);
          }
          parts.push(indent + "</" + tag + ">");
        } else {
          parts.push(indent + "<" + tag + attrStr + " />");
        }
        return parts.join("\\n");
      }
      return walk(document.body, 0);
    })()
  `);

  return {
    success: true,
    url: page.url(),
    title: await page.title(),
    snapshot: (snapshot as string).slice(0, config.maxContentLength),
    truncated: (snapshot as string).length > config.maxContentLength,
  };
}

async function uploadScreenshotToDrive(screenshotBuffer: Buffer, filename: string, pageTitle: string, parentFolderId?: string): Promise<{ driveUrl?: string; directDownloadUrl?: string }> {
  try {
    const result = await uploadAndShare({
      fileData: screenshotBuffer,
      fileName: filename,
      description: `Browser screenshot: ${pageTitle}`,
      folderLabel: "screenshots",
      parentFolderId: parentFolderId || undefined,
    });
    if (result.success) {
      return {
        driveUrl: result.imageUrl || result.viewUrl,
        directDownloadUrl: result.downloadUrl,
      };
    }
    console.warn("[browser] Drive upload failed:", result.error);
  } catch (err: any) {
    console.warn("[browser] Drive upload error:", err.message);
  }
  return {};
}

export async function takeScreenshot(index?: number, fullPage?: boolean, selector?: string, profileName?: string, tenantId?: number, returnBase64?: boolean): Promise<any> {
  let page: Page;

  if (tenantId) {
    const session = await getTenantSession(tenantId, profileName);
    page = await getPageForSession(session, index);
    recordAction(session);
  } else {
    const browser = await getOrCreateSharedBrowser(profileName || loadBrowserConfig().defaultProfile);
    const pages = await browser.pages();
    page = index !== undefined ? pages[index] : pages[0];
  }

  if (!page) return { success: false, error: "No page available. Navigate to a URL first." };

  try {
    await page.evaluate(`
      new Promise((resolve) => {
        const imgs = Array.from(document.querySelectorAll('img'));
        const pending = imgs.filter(img => !img.complete);
        if (pending.length === 0) return resolve(true);
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(true); } };
        setTimeout(done, 3000);
        let loaded = 0;
        for (const img of pending) {
          img.addEventListener('load', () => { loaded++; if (loaded >= pending.length) done(); });
          img.addEventListener('error', () => { loaded++; if (loaded >= pending.length) done(); });
        }
      })
    `);
  } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }

  let screenshotBuffer: Buffer;
  if (selector) {
    const safe = sanitizeSelector(selector);
    const el = await page.$(safe);
    if (!el) return { success: false, error: `Could not find element matching "${selector}" on the page.` };
    screenshotBuffer = await el.screenshot({ type: "png" }) as Buffer;
  } else {
    screenshotBuffer = await page.screenshot({ type: "png", fullPage: fullPage ?? false }) as Buffer;
  }

  const tenantDir = tenantId ? `${tenantId}` : "global";
  const screenshotDir = path.join(BROWSER_SCREENSHOTS_BASE, tenantDir);
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  const filename = `screenshot-${Date.now()}.png`;
  const filepath = path.join(screenshotDir, filename);
  fs.writeFileSync(filepath, screenshotBuffer);

  const oldFiles = fs.readdirSync(screenshotDir)
    .filter(f => f.startsWith("screenshot-") && f.endsWith(".png"))
    .sort()
    .slice(0, -20);
  for (const f of oldFiles) {
    try { fs.unlinkSync(path.join(screenshotDir, f)); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  }

  const localScreenshotUrl = `/api/browser/screenshots/${tenantDir}/${filename}`;
  const pageTitle = await page.title();

  try {
    const thumbBuf = await page.screenshot({ type: "jpeg", quality: 50 }) as Buffer;
    const screenshotBase64Thumb = `data:image/jpeg;base64,${thumbBuf.toString("base64")}`;
    emitBrowserLive(tenantId, "screenshot", `Screenshot: ${pageTitle}`, { screenshotUrl: localScreenshotUrl, screenshotBase64: screenshotBase64Thumb, pageTitle, pageUrl: page.url() });
  } catch {
    emitBrowserLive(tenantId, "screenshot", `Screenshot: ${pageTitle}`, { screenshotUrl: localScreenshotUrl, pageTitle, pageUrl: page.url() });
  }

  const driveResult = await uploadScreenshotToDrive(screenshotBuffer, filename, pageTitle);

  const result: any = {
    success: true,
    screenshotUrl: localScreenshotUrl,
    screenshotMarkdown: `![Screenshot of ${pageTitle}](${localScreenshotUrl})`,
    downloadHint: driveResult.directDownloadUrl
      ? `Screenshot uploaded to Google Drive. [Download here](${driveResult.directDownloadUrl})`
      : `Screenshot saved. It appears inline in the chat automatically. The user can click it to view full size.`,
    path: filepath,
    size: screenshotBuffer.length,
    url: page.url(),
    title: pageTitle,
  };
  if (driveResult.driveUrl) result.driveUrl = driveResult.driveUrl;
  if (driveResult.directDownloadUrl) result.downloadUrl = driveResult.directDownloadUrl;

  if (returnBase64) {
    result.base64 = screenshotBuffer.toString("base64");
  }

  return result;
}

// ─── Browser Action Executor ──────────────────────────────

export type BrowserAction =
  | { action: "navigate"; url: string; profile?: string; _tenantId?: number }
  | { action: "screenshot"; selector?: string; fullPage?: boolean; tabIndex?: number; profile?: string; _tenantId?: number; returnBase64?: boolean }
  | { action: "content"; selector?: string; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "click"; selector: string; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "type"; selector: string; text: string; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "evaluate"; script: string; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "tabs"; profile?: string; _tenantId?: number }
  | { action: "snapshot"; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "open_tab"; url: string; profile?: string; _tenantId?: number }
  | { action: "close_tab"; tabIndex: number; profile?: string; _tenantId?: number }
  | { action: "focus_tab"; tabIndex: number; profile?: string; _tenantId?: number }
  | { action: "wait"; ms?: number; profile?: string; _tenantId?: number }
  | { action: "pdf"; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "select"; selector: string; value: string; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "health"; profile?: string; _tenantId?: number }
  | { action: "smart_browse"; url: string; profile?: string; _tenantId?: number }
  | { action: "form_fill"; fields: Array<{ selector: string; value: string; type?: "type" | "select" | "click" }>; tabIndex?: number; profile?: string; _tenantId?: number }
  | { action: "close_session"; profile?: string; _tenantId?: number }
  | { action: "vision_browse"; url?: string; scrollY?: number; returnBase64?: boolean; profile?: string; _tenantId?: number }
  | { action: "vision_act"; mark: number; type: "click" | "type" | "hover" | "select"; text?: string; profile?: string; _tenantId?: number }
  | { action: "scroll_down"; returnBase64?: boolean; profile?: string; _tenantId?: number }
  | { action: "scroll_up"; returnBase64?: boolean; profile?: string; _tenantId?: number }
  | { action: "read_page_md"; tabIndex?: number; maxChars?: number; profile?: string; _tenantId?: number }
  | { action: "act_by_id"; vcId: string; type: "click" | "type" | "hover" | "select"; text?: string; tabIndex?: number; profile?: string; _tenantId?: number }
  & { _projectDriveFolderId?: string };

// ─── R69: Element-ID Markdown extraction (NativeMind-inspired) ──────────────
// Tags every interactive element with data-vc-id="vc-N" so the model can act
// on stable IDs ([data-vc-id="vc-7"]) instead of fighting fragile CSS selectors.
async function extractMarkdownWithIds(page: Page, maxChars: number): Promise<{
  markdown: string;
  ids: Array<{ vcId: string; tag: string; text?: string; role?: string; href?: string; type?: string }>;
  url: string;
  title: string;
  truncated: boolean;
}> {
  const result = await page.evaluate(`(function(){
    var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,SVG:1,PATH:1,HEAD:1,LINK:1,META:1,IFRAME:1,OBJECT:1,EMBED:1};
    var STRIP_BLOCKS = {NAV:1,FOOTER:1,ASIDE:1};
    var INTERACTIVE = {A:1,BUTTON:1,INPUT:1,SELECT:1,TEXTAREA:1};
    var INTERACTIVE_ROLES = {button:1,link:1,textbox:1,menuitem:1,tab:1,checkbox:1,radio:1,switch:1,combobox:1,searchbox:1};
    var counter = 0;
    var ids = [];
    function clean(s){ return (s||"").replace(/\\s+/g," ").trim().slice(0,200); }
    function isInteractive(el){
      if (INTERACTIVE[el.tagName]) return true;
      var r = el.getAttribute && el.getAttribute("role");
      if (r && INTERACTIVE_ROLES[r]) return true;
      if (el.getAttribute && el.getAttribute("contenteditable") === "true") return true;
      if (el.onclick || (el.getAttribute && el.getAttribute("onclick"))) return true;
      return false;
    }
    function isVisible(el){
      if (!el || !el.getBoundingClientRect) return true;
      var s = window.getComputedStyle(el);
      if (!s) return true;
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity||"1") === 0) return false;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
      return true;
    }
    function tagInteractive(el){
      var info = { vcId: "vc-" + (++counter), tag: el.tagName.toLowerCase() };
      el.setAttribute("data-vc-id", info.vcId);
      var role = el.getAttribute("role");
      if (role) info.role = role;
      var label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || "";
      var text = clean(label || el.innerText || el.value || el.placeholder || "");
      if (text) info.text = text;
      if (el.tagName === "A") { var h = el.getAttribute("href"); if (h) info.href = h.slice(0,200); }
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
        var t = el.getAttribute("type") || el.tagName.toLowerCase();
        info.type = t;
      }
      ids.push(info);
      return info;
    }
    // First clear any prior tags from a previous extraction.
    var prior = document.querySelectorAll("[data-vc-id]");
    for (var i = 0; i < prior.length; i++) prior[i].removeAttribute("data-vc-id");

    var out = [];
    function walk(node, depth){
      if (depth > 24) return;
      if (!node || node.nodeType !== 1) return;
      var tag = node.tagName;
      if (SKIP[tag]) return;
      if (STRIP_BLOCKS[tag]) return;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return;
      if (!isVisible(node)) return;

      var info = isInteractive(node) ? tagInteractive(node) : null;

      // Render block-level markdown for headings/lists/paragraphs.
      if (tag.match(/^H[1-6]$/)) {
        var lvl = parseInt(tag.slice(1));
        var ht = clean(node.innerText);
        if (ht) out.push("\\n" + "#".repeat(lvl) + " " + ht + "\\n");
        return;
      }
      if (info) {
        // Render the interactive element inline with its vcId tag.
        if (info.tag === "a") {
          out.push("[" + (info.text || "link") + "](" + (info.href || "") + ") {" + info.vcId + "}");
        } else if (info.tag === "button" || info.role === "button") {
          out.push("[BUTTON: " + (info.text || "?") + "] {" + info.vcId + "}");
        } else if (info.tag === "input") {
          var ph = node.getAttribute("placeholder") || "";
          var v = node.value || "";
          out.push("[INPUT type=" + (info.type||"text") + (ph?(' placeholder="'+clean(ph)+'"'):'') + (v?(' value="'+clean(v)+'"'):'') + "] {" + info.vcId + "}");
        } else if (info.tag === "textarea") {
          out.push("[TEXTAREA" + (node.value?(' value="'+clean(node.value)+'"'):'') + "] {" + info.vcId + "}");
        } else if (info.tag === "select") {
          var opts = Array.from(node.options||[]).slice(0,12).map(function(o){return clean(o.text);}).filter(Boolean);
          out.push("[SELECT options=[" + opts.join("|") + "] selected=\\"" + clean(node.value||"") + "\\"] {" + info.vcId + "}");
        } else {
          out.push("[" + info.tag.toUpperCase() + ": " + (info.text||"?") + "] {" + info.vcId + "}");
        }
        // Don't recurse into interactive elements — their text was captured.
        return;
      }
      if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE") {
        var children = node.children;
        if (children.length === 0) {
          var pt = clean(node.innerText);
          if (pt) out.push((tag === "LI" ? "- " : "") + pt);
        } else {
          if (tag === "LI") out.push("- ");
          for (var j = 0; j < children.length; j++) walk(children[j], depth+1);
          out.push("\\n");
        }
        return;
      }
      if (tag === "IMG") {
        var alt = node.getAttribute("alt") || "";
        var src = node.getAttribute("src") || "";
        if (alt && src) out.push("![" + clean(alt) + "](" + src.slice(0,200) + ")");
        return;
      }
      if (tag === "BR") { out.push("\\n"); return; }
      if (tag === "HR") { out.push("\\n---\\n"); return; }
      // Generic block: recurse into children.
      var kids = node.children;
      for (var k = 0; k < kids.length; k++) walk(kids[k], depth+1);
      // Capture stray text nodes for inline blocks (span, div, etc.) when no children handled it.
      if (kids.length === 0) {
        var st = clean(node.innerText);
        if (st && st.length < 500) out.push(st);
      }
    }
    walk(document.body, 0);
    var md = out.join(" ").replace(/\\s*\\n\\s*\\n+/g, "\\n\\n").replace(/[ \\t]+/g," ").trim();
    return {
      markdown: md,
      ids: ids,
      url: location.href,
      title: document.title || ""
    };
  })()`) as any;

  const md = String(result.markdown || "");
  const truncated = md.length > maxChars;
  return {
    markdown: truncated ? md.slice(0, maxChars) + "\n\n…[truncated]" : md,
    ids: result.ids || [],
    url: result.url || page.url(),
    title: result.title || "",
    truncated,
  };
}

export async function executeBrowserAction(params: BrowserAction): Promise<any> {
  const config = loadBrowserConfig();
  if (!config.enabled) {
    return { success: false, error: "The browser tool is not enabled. An admin needs to enable it in Settings → Browser Tool." };
  }

  const profileName = (params as any).profile;
  const tenantId = (params as any)._tenantId;

  if (tenantId && !checkTenantRateLimit(tenantId, config)) {
    return { success: false, error: "You're making browser requests too quickly. Please wait a moment and try again." };
  }

  if (tenantId) startLiveRefresh(tenantId);

  try {
    switch (params.action) {
      case "navigate": {
        if (!(await isUrlAllowedWithDns(params.url, config))) {
          const { isLoopbackUrl } = await import("./lib/self-health");
          const hint = isLoopbackUrl(params.url)
            ? " To confirm THIS app's own web server is up, call check_system_status (it reports web-server reachability) — internal/loopback addresses can't be reached via the browser."
            : "";
          return { success: false, error: `That URL is blocked by the security policy. Only public websites are allowed.${hint}` };
        }
        emitBrowserLive(tenantId, "navigating", `Navigating to ${new URL(params.url).hostname}...`, { pageUrl: params.url });
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session
          ? await getPageForSession(session)
          : (() => { throw new Error("Browser requires a tenant context"); })();
        if (session) recordAction(session);
        await page.goto(params.url, { waitUntil: "networkidle2", timeout: config.navigationTimeout });
        const navUrlErr = await validatePageUrlAfterAction(page, config);
        if (navUrlErr) return { success: false, error: navUrlErr };
        const navTitle = await page.title();
        try {
          const navBuf = await page.screenshot({ type: "jpeg", quality: 50 }) as Buffer;
          const navThumb = `data:image/jpeg;base64,${navBuf.toString("base64")}`;
          emitBrowserLive(tenantId, "screenshot", `Loaded: ${navTitle}`, { screenshotBase64: navThumb, pageUrl: page.url(), pageTitle: navTitle });
        } catch {
          emitBrowserLive(tenantId, "navigating", `Loaded: ${navTitle}`, { pageUrl: page.url(), pageTitle: navTitle });
        }
        captureAndNarrate(page, tenantId, `Navigated to ${new URL(params.url).hostname}`);
        return { success: true, action: "navigate", url: page.url(), title: navTitle };
      }

      case "screenshot":
        return takeScreenshot((params as any).tabIndex, params.fullPage, params.selector, profileName, tenantId, params.returnBase64);

      case "content": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);

        let text: string;
        if (params.selector) {
          const safe = sanitizeSelector(params.selector);
          const el = await page.$(safe);
          if (!el) return { success: false, error: `Could not find element "${params.selector}" on the page.` };
          text = await page.evaluate((e: any) => e.innerText, el);
        } else {
          text = await page.evaluate(`document.body.innerText`) as string;
        }

        return {
          success: true, action: "content",
          url: page.url(), title: await page.title(),
          content: text.slice(0, config.maxContentLength),
          truncated: text.length > config.maxContentLength,
          length: text.length,
        };
      }

      case "click": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);
        const safe = sanitizeSelector(params.selector);
        emitBrowserLive(tenantId, "clicking", `Clicking: ${params.selector.slice(0, 60)}`, { pageUrl: page.url() });
        await humanDelay(100, 300);
        await page.click(safe, { timeout: 5000, delay: Math.floor(Math.random() * 80) + 30 } as any);
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
        const clickUrlErr = await validatePageUrlAfterAction(page, config);
        if (clickUrlErr) return { success: false, error: clickUrlErr };
        try {
          const clickBuf = await page.screenshot({ type: "jpeg", quality: 50 }) as Buffer;
          const clickThumb = `data:image/jpeg;base64,${clickBuf.toString("base64")}`;
          const clickTitle = await page.title().catch(() => "");
          emitBrowserLive(tenantId, "screenshot", `Clicked: ${clickTitle || params.selector.slice(0, 40)}`, { screenshotBase64: clickThumb, pageTitle: clickTitle, pageUrl: page.url() });
        } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
        captureAndNarrate(page, tenantId, `Clicked "${params.selector.slice(0, 40)}"`);
        return { success: true, action: "click", selector: params.selector, url: page.url(), title: await page.title() };
      }

      case "type": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);
        const safe = sanitizeSelector(params.selector);
        emitBrowserLive(tenantId, "typing", `Typing into: ${params.selector.slice(0, 60)}`, { pageUrl: page.url() });
        await humanDelay(100, 300);
        await page.click(safe, { timeout: 5000 } as any);
        await page.type(safe, params.text, { delay: Math.floor(Math.random() * 60) + 40 });
        const typeUrlErr = await validatePageUrlAfterAction(page, config);
        if (typeUrlErr) return { success: false, error: typeUrlErr };
        try {
          const typeBuf = await page.screenshot({ type: "jpeg", quality: 50 }) as Buffer;
          const typeThumb = `data:image/jpeg;base64,${typeBuf.toString("base64")}`;
          emitBrowserLive(tenantId, "screenshot", `Typed into form`, { screenshotBase64: typeThumb, pageUrl: page.url(), pageTitle: await page.title().catch(() => "") });
        } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
        captureAndNarrate(page, tenantId, `Typed ${params.text.length} chars into form field`);
        return { success: true, action: "type", selector: params.selector, textLength: params.text.length };
      }

      case "evaluate": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);

        const DANGEROUS = /\b(fetch|XMLHttpRequest|WebSocket|eval|Function|import|location)\s*[\s(=.]/i;
        if (DANGEROUS.test(params.script)) {
          return { success: false, error: "That script contains network, eval, or navigation calls which are not allowed for security." };
        }

        const result = await page.evaluate(params.script);
        const evalUrlErr = await validatePageUrlAfterAction(page, config);
        if (evalUrlErr) return { success: false, error: evalUrlErr };
        return { success: true, action: "evaluate", result: JSON.stringify(result)?.slice(0, 10000) };
      }

      case "tabs":
        return listTabs(profileName, tenantId);

      case "snapshot":
        return getPageSnapshot((params as any).tabIndex, profileName, tenantId);

      case "open_tab":
        return openTab(params.url, profileName, tenantId);

      case "close_tab":
        return closeTab(params.tabIndex, profileName, tenantId);

      case "focus_tab":
        return focusTab(params.tabIndex, profileName, tenantId);

      case "wait": {
        const ms = Math.min(params.ms || 1000, 10000);
        await new Promise(resolve => setTimeout(resolve, ms));
        return { success: true, action: "wait", waitedMs: ms };
      }

      case "pdf": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);

        const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
        const tenantDir = tenantId ? `${tenantId}` : "global";
        const pdfDir = path.join(BROWSER_SCREENSHOTS_BASE, tenantDir);
        if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
        const filename = `page-${Date.now()}.pdf`;
        const filepath = path.join(pdfDir, filename);
        fs.writeFileSync(filepath, pdfBuffer);
        return { success: true, action: "pdf", path: filepath, size: pdfBuffer.length, url: page.url() };
      }

      case "select": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);
        const safe = sanitizeSelector(params.selector);
        await page.select(safe, params.value);
        const selectUrlErr = await validatePageUrlAfterAction(page, config);
        if (selectUrlErr) return { success: false, error: selectUrlErr };
        captureAndNarrate(page, tenantId, `Selected "${params.value}" in dropdown`);
        return { success: true, action: "select", selector: params.selector, value: params.value };
      }

      case "health":
        return checkConnectionHealth(profileName);

      case "smart_browse": {
        if (!(await isUrlAllowedWithDns(params.url, config))) {
          return { success: false, error: "That URL is blocked by the security policy." };
        }
        emitBrowserLive(tenantId, "browsing", `Browsing: ${new URL(params.url).hostname}...`, { pageUrl: params.url });
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        if (!session) return { success: false, error: "Browser requires a tenant context" };
        recordAction(session);

        const page = await getPageForSession(session);
        await page.goto(params.url, { waitUntil: "networkidle2", timeout: config.navigationTimeout });
        const smartRedirectErr = await validatePageUrlAfterAction(page, config);
        if (smartRedirectErr) return { success: false, error: smartRedirectErr };

        try {
          const earlyBuf = await page.screenshot({ type: "jpeg", quality: 45 }) as Buffer;
          const earlyThumb = `data:image/jpeg;base64,${earlyBuf.toString("base64")}`;
          const earlyTitle = await page.title().catch(() => "");
          emitBrowserLive(tenantId, "screenshot", `Loading: ${earlyTitle || new URL(params.url).hostname}`, {
            screenshotBase64: earlyThumb,
            pageTitle: earlyTitle,
            pageUrl: page.url(),
          });
        } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }

        try {
          await page.evaluate(`
            new Promise((resolve) => {
              const imgs = Array.from(document.querySelectorAll('img'));
              const pending = imgs.filter(img => !img.complete);
              if (pending.length === 0) return resolve(true);
              let resolved = false;
              const done = () => { if (!resolved) { resolved = true; resolve(true); } };
              setTimeout(done, 3000);
              let loaded = 0;
              for (const img of pending) {
                img.addEventListener('load', () => { loaded++; if (loaded >= pending.length) done(); });
                img.addEventListener('error', () => { loaded++; if (loaded >= pending.length) done(); });
              }
            })
          `);
        } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }

        const title = await page.title();
        const url = page.url();

        const screenshotBuffer = await page.screenshot({ type: "png", fullPage: false }) as Buffer;
        const tenantDir = `${tenantId}`;
        const screenshotDir = path.join(BROWSER_SCREENSHOTS_BASE, tenantDir);
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const filename = `screenshot-${Date.now()}.png`;
        const filepath = path.join(screenshotDir, filename);
        fs.writeFileSync(filepath, screenshotBuffer);

        const textContent = await page.evaluate(`
          (function() {
            var el = document.querySelector("main") || document.querySelector("article") || document.body;
            return el ? el.innerText.slice(0, 5000) : "";
          })()
        `);

        const links = await page.evaluate(`
          (function() {
            return Array.from(document.querySelectorAll("a[href]")).slice(0, 20).map(function(a) {
              return { text: (a.innerText || "").trim().slice(0, 80), href: a.href };
            }).filter(function(l) { return l.text && l.href.indexOf("http") === 0; });
          })()
        `);

        const formFields = await page.evaluate(`
          (function() {
            return Array.from(document.querySelectorAll("input, select, textarea")).slice(0, 15).map(function(el) {
              return {
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type") || "",
                name: el.getAttribute("name") || "",
                id: el.id || "",
                placeholder: el.getAttribute("placeholder") || ""
              };
            });
          })()
        `);

        const localSmartUrl = `/api/browser/screenshots/${tenantDir}/${filename}`;
        let smartBase64Thumb: string | undefined;
        try {
          const smartThumbBuf = await page.screenshot({ type: "jpeg", quality: 50 }) as Buffer;
          smartBase64Thumb = `data:image/jpeg;base64,${smartThumbBuf.toString("base64")}`;
        } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }

        emitBrowserLive(tenantId, "screenshot", `Captured: ${title}`, { screenshotUrl: localSmartUrl, screenshotBase64: smartBase64Thumb, pageTitle: title, pageUrl: url });

        geminiVisionNarrate(screenshotBuffer.toString("base64"), url, `Browsed ${new URL(params.url).hostname}`).then((narration) => {
          if (narration) {
            emitBrowserLive(tenantId, "analyzing", narration, {
              screenshotUrl: localSmartUrl,
              pageTitle: title,
              pageUrl: url,
              visionNarration: narration,
            });
          }
        });

        const smartDriveResult = await uploadScreenshotToDrive(screenshotBuffer, filename, title, (params as any)._projectDriveFolderId);

        const smartResult: any = {
          success: true,
          action: "smart_browse",
          url,
          title,
          screenshotUrl: localSmartUrl,
          screenshotMarkdown: `![Screenshot of ${title}](${localSmartUrl})`,
          downloadHint: smartDriveResult.directDownloadUrl
            ? `Screenshot uploaded to Google Drive. [Download here](${smartDriveResult.directDownloadUrl})`
            : `Screenshot saved. It appears inline in the chat automatically. The user can click it to view full size.`,
          content: (textContent as string).slice(0, config.maxContentLength),
          contentTruncated: (textContent as string).length > config.maxContentLength,
          linksFound: (links as any[]).length,
          links: (links as any[]).slice(0, 10),
          formFields: (formFields as any[]).length > 0 ? formFields : undefined,
        };
        if (smartDriveResult.driveUrl) smartResult.driveUrl = smartDriveResult.driveUrl;
        if (smartDriveResult.directDownloadUrl) smartResult.downloadUrl = smartDriveResult.directDownloadUrl;
        return smartResult;
      }

      case "form_fill": {
        const session = tenantId ? await getTenantSession(tenantId, profileName) : null;
        const page = session ? await getPageForSession(session, (params as any).tabIndex) : null;
        if (!page) return { success: false, error: "No page is open. Navigate to a URL first." };
        if (session) recordAction(session);

        const results: Array<{ selector: string; status: string; error?: string }> = [];
        for (const field of params.fields) {
          try {
            const safe = sanitizeSelector(field.selector);
            const fillType = field.type || "type";
            if (fillType === "select") {
              await page.select(safe, field.value);
            } else if (fillType === "click") {
              await page.click(safe, { timeout: 5000 } as any);
            } else {
              await page.click(safe, { timeout: 5000 } as any).catch(() => {});
              await page.evaluate((sel: any) => {
                const el = document.querySelector(sel);
                if (el) (el as any).value = "";
              }, safe);
              await page.type(safe, field.value, { delay: 30 });
            }
            results.push({ selector: field.selector, status: "filled" });
          } catch (err: any) {
            results.push({ selector: field.selector, status: "failed", error: err.message });
          }
        }

        const formFillUrlErr = await validatePageUrlAfterAction(page, config);
        if (formFillUrlErr) return { success: false, error: formFillUrlErr };
        captureAndNarrate(page, tenantId, `Filled ${results.filter(r => r.status === "filled").length} form fields`);
        return {
          success: results.every(r => r.status === "filled"),
          action: "form_fill",
          url: page.url(),
          results,
          filledCount: results.filter(r => r.status === "filled").length,
          failedCount: results.filter(r => r.status === "failed").length,
        };
      }

      case "close_session": {
        if (!tenantId) return { success: false, error: "No tenant context" };
        const key = sessionKey(tenantId, profileName || config.defaultProfile);
        const session = tenantSessions.get(key);
        if (session) {
          try { await session.context.close(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
          stopLiveRefresh(tenantId);
          tenantSessions.delete(key);
          tenantSomMaps.delete(somMapKey(tenantId));
          resetVisionState(tenantId);
          clearActionMemory(tenantId);
          return { success: true, action: "close_session", message: "Browser session closed." };
        }
        stopLiveRefresh(tenantId);
        return { success: true, action: "close_session", message: "No active session to close." };
      }

      case "vision_browse": {
        if (!tenantId) return { success: false, error: "Browser requires a tenant context" };
        if ((params as any).url) {
          emitBrowserLive(tenantId, "browsing", `Vision browsing: ${new URL((params as any).url).hostname}...`, { pageUrl: (params as any).url });
          resetVisionState(tenantId);
          clearActionMemory(tenantId);
          if (!(await isUrlAllowedWithDns((params as any).url, config))) {
            return { success: false, error: "That URL is blocked by the security policy." };
          }
          const vbSession = await getTenantSession(tenantId, profileName);
          recordAction(vbSession);
          const vbPage = await getPageForSession(vbSession);
          await vbPage.goto((params as any).url, { waitUntil: "networkidle2", timeout: config.navigationTimeout });
          const vbRedirectErr = await validatePageUrlAfterAction(vbPage, config);
          if (vbRedirectErr) return { success: false, error: vbRedirectErr };
        }
        return injectSomAndScreenshot(tenantId, profileName, (params as any).returnBase64, (params as any).scrollY);
      }

      case "scroll_down":
      case "scroll_up": {
        if (!tenantId) return { success: false, error: "Browser requires a tenant context" };
        emitBrowserLive(tenantId, "scrolling", `Scrolling ${(params as any).action === "scroll_down" ? "down" : "up"}...`);
        const scrollSession = await getTenantSession(tenantId, profileName);
        recordAction(scrollSession);
        const scrollPage = await getPageForSession(scrollSession);
        const vpSize = await scrollPage.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
        const scrollAmount = Math.round((vpSize as any).h * 0.8);
        const scrollDir = (params as any).action === "scroll_down" ? scrollAmount : -scrollAmount;
        await scrollPage.evaluate(`window.scrollBy(0, ${scrollDir})`);
        await new Promise(r => setTimeout(r, 1000));
        return injectSomAndScreenshot(tenantId, profileName, (params as any).returnBase64);
      }

      case "vision_act": {
        if (!tenantId) return { success: false, error: "Browser requires a tenant context" };
        const vaMark = (params as any).mark;
        const vaType = (params as any).type || "click";
        const vaText = (params as any).text;
        if (vaMark === undefined || vaMark === null) {
          return { success: false, error: "mark is required — the number shown on the red label in the annotated screenshot." };
        }
        return executeVisionAct(tenantId, vaMark, vaType, vaText, profileName);
      }

      case "read_page_md": {
        if (!tenantId) return { success: false, error: "Browser requires a tenant context" };
        const rpmIdx = (params as any).tabIndex;
        const rpmMax = Math.max(2000, Math.min((params as any).maxChars || config.maxContentLength || 30000, 60000));
        const rpmSession = await getTenantSession(tenantId, profileName);
        recordAction(rpmSession);
        const rpmPage = await getPageForSession(rpmSession, rpmIdx);
        emitBrowserLive(tenantId, "analyzing", `Reading page as markdown with element IDs...`, { pageUrl: rpmPage.url() });
        try {
          const out = await extractMarkdownWithIds(rpmPage, rpmMax);
          return {
            success: true,
            url: out.url,
            title: out.title,
            markdown: out.markdown,
            interactiveCount: out.ids.length,
            ids: out.ids,
            truncated: out.truncated,
            _hint: "Each interactive element has a {vc-N} tag. To act on one, call browser with action=act_by_id, vcId='vc-N', type='click'|'type'|'hover'|'select', and (for type/select) text. IDs are valid until you navigate or refresh.",
          };
        } catch (e: any) {
          return { success: false, error: `read_page_md failed: ${e?.message || e}` };
        }
      }

      case "act_by_id": {
        if (!tenantId) return { success: false, error: "Browser requires a tenant context" };
        const abVcId = String((params as any).vcId || "").trim();
        const abType = (params as any).type || "click";
        const abText = (params as any).text;
        const abIdx = (params as any).tabIndex;
        if (!/^vc-\d+$/.test(abVcId)) {
          return { success: false, error: "vcId must look like 'vc-7'. Call read_page_md first to get valid IDs." };
        }
        const abSession = await getTenantSession(tenantId, profileName);
        recordAction(abSession);
        const abPage = await getPageForSession(abSession, abIdx);
        const abSelector = `[data-vc-id="${abVcId}"]`;
        const exists = await abPage.$(abSelector);
        if (!exists) {
          return { success: false, error: `Element ${abVcId} not found on the current page. The page likely navigated or re-rendered. Call read_page_md again to get fresh IDs.` };
        }
        emitBrowserLive(tenantId, "clicking", `Acting on ${abVcId} (${abType})...`, { pageUrl: abPage.url() });
        try {
          await humanDelay();
          if (abType === "click") {
            await abPage.click(abSelector, { timeout: 10000 } as any);
          } else if (abType === "hover") {
            await abPage.hover(abSelector);
          } else if (abType === "type") {
            if (abText === undefined) return { success: false, error: "text is required for type action" };
            await abPage.click(abSelector, { timeout: 10000 } as any);
            // Clear existing value (puppeteer has no .fill — use evaluate).
            await abPage.evaluate((sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
              if (el && "value" in el) el.value = "";
            }, abSelector).catch(() => {});
            await abPage.type(abSelector, String(abText), { delay: 50 });
          } else if (abType === "select") {
            if (abText === undefined) return { success: false, error: "text is required for select action (the option value or label)" };
            await abPage.select(abSelector, String(abText));
          } else {
            return { success: false, error: `Unknown act_by_id type: ${abType}` };
          }
          await new Promise(r => setTimeout(r, 400));
          const urlErr = await validatePageUrlAfterAction(abPage, config);
          if (urlErr) return { success: false, error: urlErr };
          return { success: true, url: abPage.url(), title: await abPage.title(), action: abType, vcId: abVcId };
        } catch (e: any) {
          return { success: false, error: `act_by_id ${abType} on ${abVcId} failed: ${e?.message || e}` };
        }
      }

      default:
        return { success: false, error: `Unknown browser action: ${(params as any).action}. Available actions: navigate, screenshot, content, click, type, smart_browse, form_fill, vision_browse, vision_act, scroll_down, scroll_up, tabs, snapshot, health, close_session.` };
    }
  } catch (err: any) {
    const friendlyErrors: Record<string, string> = {
      "Navigation timeout": "The page took too long to load. The website might be slow or unreachable.",
      "net::ERR_NAME_NOT_RESOLVED": "Could not find that website. Check if the URL is correct.",
      "net::ERR_CONNECTION_REFUSED": "The website refused the connection. It might be down or blocking automated access.",
      "net::ERR_CONNECTION_TIMED_OUT": "The connection to the website timed out. Try again later.",
      "Protocol error": "Lost connection to the browser. The session may have expired.",
    };

    for (const [pattern, friendly] of Object.entries(friendlyErrors)) {
      if (err.message.includes(pattern)) {
        return { success: false, error: friendly };
      }
    }

    if (tenantId) {
      stopLiveRefresh(tenantId);
      const key = sessionKey(tenantId, profileName || config.defaultProfile);
      const session = tenantSessions.get(key);
      if (session) {
        try { await session.context.close(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
        tenantSessions.delete(key);
      }
    }

    return { success: false, error: err.message };
  }
}

// ─── Set-of-Mark (SoM) Visual Annotator ────────────────────

const SOM_ANNOTATOR_SCRIPT = `
(function() {
  var existing = document.querySelectorAll('[data-som-label]');
  existing.forEach(function(e) { e.remove(); });

  var scrollY = window.scrollY || window.pageYOffset || 0;
  var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  var vpHeight = window.innerHeight;
  var scrollPct = docHeight > vpHeight ? Math.round((scrollY / (docHeight - vpHeight)) * 100) : 0;
  var scrollLabel = scrollY < 50 ? 'TOP' : (scrollPct >= 95 ? 'BOTTOM' : scrollPct + '%');
  var canScrollDown = (scrollY + vpHeight) < (docHeight - 20);
  var canScrollUp = scrollY > 20;

  var banner = document.createElement('div');
  banner.setAttribute('data-som-label', 'true');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(30,64,175,0.92);color:#fff;font-size:12px;font-weight:bold;font-family:monospace;padding:4px 12px;text-align:center;pointer-events:none;letter-spacing:0.5px;';
  var bannerParts = ['VIEW: ' + scrollLabel + ' of page'];
  bannerParts.push('(' + Math.round(scrollY) + 'px / ' + docHeight + 'px)');
  if (canScrollDown) bannerParts.push('| SCROLL DOWN for more');
  if (canScrollUp) bannerParts.push('| SCROLL UP available');
  banner.innerText = bannerParts.join(' ');
  document.body.appendChild(banner);

  var hasOverlay = false;
  document.querySelectorAll('div, section, aside, [role="dialog"], [role="alertdialog"], [class*="modal"], [class*="overlay"], [class*="popup"], [class*="banner"], [class*="cookie"], [class*="consent"]').forEach(function(el) {
    try {
      var s = window.getComputedStyle(el);
      if (s.position === 'fixed' && s.zIndex && parseInt(s.zIndex) > 999 && s.display !== 'none' && s.visibility !== 'hidden') {
        var r = el.getBoundingClientRect();
        if (r.width > vpHeight * 0.4 && r.height > vpHeight * 0.3 && !el.hasAttribute('data-som-label')) {
          hasOverlay = true;
        }
      }
    } catch (e) { void e; /* browser-context catch: server helper unavailable here */ }
  });

  var selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="option"], [contenteditable="true"], label[for], summary, details > summary, [tabindex]:not([tabindex="-1"]), [onclick]';
  var elements = document.querySelectorAll(selectors);
  var elementMap = {};
  var markIndex = 0;

  elements.forEach(function(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    if (rect.top > window.innerHeight + 100 || rect.bottom < -100) return;
    if (rect.left > window.innerWidth + 100 || rect.right < -100) return;

    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute('type') || '';
    var text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('name') || '').trim().slice(0, 60);
    var role = el.getAttribute('role') || '';
    var href = el.getAttribute('href') || '';

    var label = document.createElement('div');
    label.setAttribute('data-som-label', 'true');
    label.innerText = markIndex;
    label.style.cssText = 'position:fixed;z-index:2147483647;background:rgba(220,38,38,0.92);color:#fff;font-size:11px;font-weight:bold;font-family:monospace;padding:1px 4px;border-radius:3px;pointer-events:none;line-height:14px;min-width:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.4);';
    label.style.left = Math.max(0, rect.left) + 'px';
    label.style.top = Math.max(0, rect.top - 16) + 'px';
    if (rect.top < 30) label.style.top = (rect.bottom + 2) + 'px';
    document.body.appendChild(label);

    var outline = document.createElement('div');
    outline.setAttribute('data-som-label', 'true');
    outline.style.cssText = 'position:fixed;z-index:2147483646;border:2px solid rgba(220,38,38,0.7);pointer-events:none;border-radius:2px;';
    outline.style.left = rect.left + 'px';
    outline.style.top = rect.top + 'px';
    outline.style.width = rect.width + 'px';
    outline.style.height = rect.height + 'px';
    document.body.appendChild(outline);

    elementMap[markIndex] = {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      tag: tag,
      type: type,
      role: role,
      text: text,
      href: href.slice(0, 200),
      id: (el.id || '').slice(0, 60),
      selector: buildSelector(el)
    };
    markIndex++;
  });

  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var tag = el.tagName.toLowerCase();
    var nth = 1;
    var sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) nth++;
      sib = sib.previousElementSibling;
    }
    var parent = el.parentElement;
    if (parent && parent !== document.body) {
      return buildSelector(parent) + ' > ' + tag + ':nth-of-type(' + nth + ')';
    }
    return tag + ':nth-of-type(' + nth + ')';
  }

  return {
    elementMap: elementMap,
    totalMarks: markIndex,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pageUrl: window.location.href,
    pageTitle: document.title,
    scroll: { y: Math.round(scrollY), docHeight: docHeight, vpHeight: vpHeight, pct: scrollPct, position: scrollLabel, canScrollDown: canScrollDown, canScrollUp: canScrollUp },
    hasBlockingOverlay: hasOverlay
  };
})()
`;

const SOM_CLEAR_SCRIPT = `
(function() {
  var labels = document.querySelectorAll('[data-som-label]');
  labels.forEach(function(e) { e.remove(); });
  return { cleared: labels.length };
})()
`;

interface SomElementInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  tag: string;
  type: string;
  role: string;
  text: string;
  href: string;
  id: string;
  selector: string;
}

interface SomScrollInfo {
  y: number;
  docHeight: number;
  vpHeight: number;
  pct: number;
  position: string;
  canScrollDown: boolean;
  canScrollUp: boolean;
}

interface SomResult {
  elementMap: Record<string, SomElementInfo>;
  totalMarks: number;
  viewportWidth: number;
  viewportHeight: number;
  pageUrl: string;
  pageTitle: string;
  scroll: SomScrollInfo;
  hasBlockingOverlay: boolean;
}

const tenantSomMaps = new Map<string, SomResult>();

interface VisionDiffState {
  lastScreenshotHash: string;
  lastAction: { mark: number; actType: string; text?: string };
  consecutiveNoChangeCount: number;
  totalActions: number;
}

const tenantVisionState = new Map<string, VisionDiffState>();

function computeScreenshotHash(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

function getVisionState(tenantId: number): VisionDiffState | undefined {
  return tenantVisionState.get(`vision-${tenantId}`);
}

function updateVisionState(tenantId: number, hash: string, action: { mark: number; actType: string; text?: string }, pageChanged: boolean): void {
  const key = `vision-${tenantId}`;
  const existing = tenantVisionState.get(key);
  tenantVisionState.set(key, {
    lastScreenshotHash: hash,
    lastAction: action,
    consecutiveNoChangeCount: pageChanged ? 0 : (existing?.consecutiveNoChangeCount || 0) + 1,
    totalActions: (existing?.totalActions || 0) + 1,
  });
}

function resetVisionState(tenantId: number): void {
  tenantVisionState.delete(`vision-${tenantId}`);
}

// ─── Short-Term Action Memory ──────────────────────────────
// Rolling buffer of the last N vision actions per tenant.
// Gives the AI narrative context: "I already tried clicking Sign In and it failed."

const MEMORY_BUFFER_SIZE = 5;

interface VisionMemoryEntry {
  step: number;
  timestamp: number;
  action: string;
  mark: number;
  elementTag: string;
  elementText: string;
  elementHref?: string;
  text?: string;
  pageChanged: boolean;
  urlBefore: string;
  urlAfter: string;
  outcome: "succeeded" | "failed_no_change" | "failed_error";
  errorMessage?: string;
}

const tenantActionMemory = new Map<string, VisionMemoryEntry[]>();

function memoryKey(tenantId: number): string {
  return `mem-${tenantId}`;
}

function getActionMemory(tenantId: number): VisionMemoryEntry[] {
  return tenantActionMemory.get(memoryKey(tenantId)) || [];
}

function recordActionMemory(tenantId: number, entry: VisionMemoryEntry): void {
  const key = memoryKey(tenantId);
  const existing = tenantActionMemory.get(key) || [];
  existing.push(entry);
  if (existing.length > MEMORY_BUFFER_SIZE) {
    existing.splice(0, existing.length - MEMORY_BUFFER_SIZE);
  }
  tenantActionMemory.set(key, existing);
}

function clearActionMemory(tenantId: number): void {
  tenantActionMemory.delete(memoryKey(tenantId));
}

function getNextStepNumber(tenantId: number): number {
  const mem = getActionMemory(tenantId);
  if (mem.length === 0) return 1;
  return mem[mem.length - 1].step + 1;
}

function formatActionMemory(tenantId: number): string {
  const mem = getActionMemory(tenantId);
  if (mem.length === 0) return "";

  const lines = mem.map(entry => {
    const status = entry.outcome === "succeeded"
      ? "OK — page changed"
      : entry.outcome === "failed_no_change"
        ? "FAILED — page did NOT change (no-op)"
        : `ERROR — ${entry.errorMessage || "action threw exception"}`;
    const desc = [`Step ${entry.step}: ${entry.action.toUpperCase()} mark [${entry.mark}]`];
    desc.push(`${entry.elementTag} "${entry.elementText}"`);
    if (entry.text) desc.push(`text="${entry.text}"`);
    desc.push(`→ ${status}`);
    if (entry.urlBefore !== entry.urlAfter) desc.push(`(navigated: ${entry.urlAfter})`);
    return desc.join(" ");
  });

  const failedElements = mem
    .filter(e => e.outcome !== "succeeded")
    .map(e => `"${e.elementText}" (${e.action})`)
    .filter((v, i, a) => a.indexOf(v) === i);

  let summary = `RECENT ACTION HISTORY (last ${mem.length} steps):\n${lines.join("\n")}`;
  if (failedElements.length > 0) {
    summary += `\n⚠ ELEMENTS THAT DID NOT WORK: ${failedElements.join(", ")} — do NOT retry these.`;
  }
  return summary;
}

function somMapKey(tenantId: number): string {
  return `som-${tenantId}`;
}

async function autoDismissOverlays(page: any): Promise<{ dismissed: number }> {
  let totalDismissed = 0;
  try {
    const result = await page.evaluate(`
      (function() {
        var dismissed = 0;

        var overlaySelectors = [
          '[class*="cookie"] button',
          '[class*="consent"] button',
          '[id*="cookie"] button',
          '[id*="consent"] button',
          '[class*="gdpr"] button',
          '[aria-label*="cookie" i]',
          '[aria-label*="consent" i]',
          '[aria-label*="accept" i]',
          '[class*="modal"] [class*="close"]',
          '[class*="popup"] [class*="close"]',
          '[class*="overlay"] [class*="close"]',
          '[class*="banner"] [class*="close"]',
          '[class*="newsletter"] [class*="close"]',
          '[class*="subscribe"] [class*="close"]',
          '[class*="notification"] [class*="close"]',
          '[class*="alert"] [class*="close"]',
          '[class*="dialog"] [class*="close"]',
        ];
        var acceptPatterns = /^(accept|accept all|agree|allow|allow all|ok|okay|got it|i understand|yes|close|x|dismiss|no thanks|no,? thanks|continue|i agree|reject all|decline|necessary only|confirm)$/i;

        overlaySelectors.forEach(function(sel) {
          try {
            document.querySelectorAll(sel).forEach(function(btn) {
              var text = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
              if (text.length < 40 && acceptPatterns.test(text)) {
                btn.click();
                dismissed++;
              }
            });
          } catch (e) { void e; /* browser-context catch: server helper unavailable here */ }
        });

        if (dismissed === 0) {
          document.querySelectorAll('button, a, [role="button"], [class*="close"], [class*="dismiss"]').forEach(function(el) {
            var text = (el.innerText || el.getAttribute('aria-label') || '').trim();
            var parent = el.closest('[class*="cookie"], [class*="consent"], [class*="banner"], [class*="popup"], [class*="overlay"], [class*="modal"], [class*="gdpr"], [class*="notification"], [class*="subscribe"], [class*="newsletter"]');
            if (parent && text.length < 40 && acceptPatterns.test(text)) {
              el.click();
              dismissed++;
            }
          });
        }

        if (dismissed === 0) {
          var vpH = window.innerHeight;
          var vpW = window.innerWidth;
          document.querySelectorAll('div, section, aside, header, footer, nav, [role="dialog"], [role="alertdialog"], [role="banner"], [class*="modal"], [class*="overlay"], [class*="popup"], [class*="banner"], [class*="cookie"], [class*="consent"]').forEach(function(el) {
            try {
              var s = window.getComputedStyle(el);
              if ((s.position === 'fixed' || s.position === 'sticky') && s.zIndex && parseInt(s.zIndex) > 999 && s.display !== 'none' && s.visibility !== 'hidden') {
                var r = el.getBoundingClientRect();
                if (r.width > vpW * 0.5 && r.height > vpH * 0.3) {
                  var closeBtn = el.querySelector('[class*="close"], [aria-label*="close" i], [aria-label*="dismiss" i], button:last-child');
                  if (closeBtn) {
                    closeBtn.click();
                    dismissed++;
                  } else {
                    var btns = el.querySelectorAll('button, [role="button"], a');
                    btns.forEach(function(b) {
                      var t = (b.innerText || '').trim();
                      if (t.length < 40 && acceptPatterns.test(t)) {
                        b.click();
                        dismissed++;
                      }
                    });
                  }
                }
              }
            } catch (e) { void e; /* browser-context catch: server helper unavailable here */ }
          });
        }

        return { dismissed: dismissed };
      })()
    `) as { dismissed: number };
    totalDismissed = result?.dismissed || 0;

    if (totalDismissed > 0) {
      await new Promise(r => setTimeout(r, 800));
    }
  } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  return { dismissed: totalDismissed };
}

export async function injectSomAndScreenshot(
  tenantId: number,
  profileName?: string,
  returnBase64?: boolean,
  scrollY?: number,
): Promise<any> {
  const config = loadBrowserConfig();
  if (!config.enabled) {
    return { success: false, error: "Browser tool is not enabled." };
  }

  const session = await getTenantSession(tenantId, profileName);
  recordAction(session);
  const page = await getPageForSession(session);

  if (!page.url() || page.url() === "about:blank") {
    return { success: false, error: "No page is open. Navigate to a URL first with the browser navigate action." };
  }

  if (scrollY !== undefined && scrollY >= 0) {
    await page.evaluate(`window.scrollTo(0, ${scrollY})`);
    await new Promise(r => setTimeout(r, 500));
  }

  await page.evaluate(SOM_CLEAR_SCRIPT);

  const dismissResult = await autoDismissOverlays(page);

  // Fail-closed SSRF guard: scrollTo + autoDismissOverlays (which clicks candidate
  // dismiss buttons) are page-MUTATING and can trigger a JS/form redirect onto an
  // internal/private URL. This function is the common read chokepoint for the
  // scroll_* and vision_browse(no-url) paths, so revalidate here before any
  // page-derived data (SoM map, screenshot, content) is captured/returned.
  const somRedirectErr = await validatePageUrlAfterAction(page, config);
  if (somRedirectErr) return { success: false, error: somRedirectErr };

  const somResult = await page.evaluate(SOM_ANNOTATOR_SCRIPT) as SomResult;

  const screenshotBuffer = await page.screenshot({ type: "png", fullPage: false }) as Buffer;

  await page.evaluate(SOM_CLEAR_SCRIPT);

  tenantSomMaps.set(somMapKey(tenantId), somResult);

  const tenantDir = `${tenantId}`;
  const screenshotDir = path.join(BROWSER_SCREENSHOTS_BASE, tenantDir);
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  const filename = `som-${Date.now()}.png`;
  const filepath = path.join(screenshotDir, filename);
  fs.writeFileSync(filepath, screenshotBuffer);

  const localSomUrl = `/api/browser/screenshots/${tenantDir}/${filename}`;
  let somBase64Thumb: string | undefined;
  try {
    const somThumbBuf = await page.screenshot({ type: "jpeg", quality: 50 }) as Buffer;
    somBase64Thumb = `data:image/jpeg;base64,${somThumbBuf.toString("base64")}`;
  } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
  emitBrowserLive(tenantId, "screenshot", `Vision scan: ${somResult.pageTitle}`, { screenshotUrl: localSomUrl, screenshotBase64: somBase64Thumb, pageTitle: somResult.pageTitle, pageUrl: somResult.pageUrl || "" });

  const driveResult = await uploadScreenshotToDrive(screenshotBuffer, filename, somResult.pageTitle);

  const overlayMarks: string[] = [];
  const elementSummary = Object.entries(somResult.elementMap)
    .slice(0, 60)
    .map(([idx, el]) => {
      const parts = [`[${idx}]`, el.tag];
      if (el.type) parts.push(`type=${el.type}`);
      if (el.role) parts.push(`role=${el.role}`);
      if (el.text) parts.push(`"${el.text}"`);
      if (el.href) parts.push(`→ ${el.href.slice(0, 80)}`);
      const lowerText = (el.text || "").toLowerCase();
      if (/accept|cookie|consent|agree|dismiss|got it|close|no thanks|i understand|allow/i.test(lowerText)) {
        overlayMarks.push(`[${idx}] "${el.text}" (likely cookie/popup dismiss button)`);
      }
      return parts.join(" ");
    })
    .join("\n");

  const currentHash = computeScreenshotHash(screenshotBuffer);
  const visionState = getVisionState(tenantId);
  let diffWarning: string | undefined;
  if (visionState) {
    const noChangeCount = visionState.consecutiveNoChangeCount;
    if (noChangeCount > 0) {
      diffWarning = `WARNING: Your last action (${visionState.lastAction.actType} mark [${visionState.lastAction.mark}]) did NOT change the page state (identical screenshot ${noChangeCount} time(s) in a row). The element may be inactive, disabled, or decorative. Do NOT repeat the same action. Try: (1) a different element, (2) scrolling to reveal new content, (3) a completely different approach.`;
      if (noChangeCount >= 3) {
        diffWarning += ` CRITICAL: ${noChangeCount} consecutive no-change actions. You are likely stuck in an infinite loop. STOP clicking the same elements. Try navigating to a different page or using a search function instead.`;
      }
    }
  }

  const scroll = somResult.scroll;
  const scrollContext = `Viewport: ${scroll.position} (${scroll.y}px of ${scroll.docHeight}px total)${scroll.canScrollDown ? " — MORE CONTENT BELOW, use vision_browse with scrollY to see it" : " — at bottom, no more content below"}`;

  const result: any = {
    success: true,
    action: "vision_browse",
    url: somResult.pageUrl,
    title: somResult.pageTitle,
    totalMarks: somResult.totalMarks,
    viewport: { width: somResult.viewportWidth, height: somResult.viewportHeight },
    scroll: {
      position: scroll.position,
      y: scroll.y,
      docHeight: scroll.docHeight,
      canScrollDown: scroll.canScrollDown,
      canScrollUp: scroll.canScrollUp,
      nextScrollY: scroll.canScrollDown ? scroll.y + Math.round(scroll.vpHeight * 0.8) : null,
    },
    scrollContext,
    screenshotUrl: localSomUrl,
    screenshotMarkdown: `![SoM annotated screenshot of ${somResult.pageTitle}](${localSomUrl})`,
    elementSummary,
    hint: `OBSERVE PHASE COMPLETE — ${somResult.totalMarks} interactable elements marked. ${scrollContext}`,
    instructions: {
      click: '{ "action": "vision_act", "mark": <N>, "type": "click" }',
      type: '{ "action": "vision_act", "mark": <N>, "type": "type", "text": "your text" }',
      scroll_down: scroll.canScrollDown
        ? `{ "action": "vision_browse", "scrollY": ${scroll.y + Math.round(scroll.vpHeight * 0.8)} }`
        : "ALREADY AT BOTTOM — no more content below",
      scroll_up: scroll.canScrollUp
        ? `{ "action": "vision_browse", "scrollY": ${Math.max(0, scroll.y - Math.round(scroll.vpHeight * 0.8))} }`
        : "ALREADY AT TOP",
      done: "When objective is met, STOP the loop and report results to the user.",
    },
  };
  if (diffWarning) {
    result.stateWarning = diffWarning;
  }
  result.hasBlockingOverlay = somResult.hasBlockingOverlay;
  if (overlayMarks.length > 0 || somResult.hasBlockingOverlay) {
    const parts: string[] = [];
    if (somResult.hasBlockingOverlay) {
      parts.push("BLOCKING OVERLAY DETECTED — A large fixed-position element is covering the page. You MUST dismiss it before interacting with page content behind it.");
    }
    if (overlayMarks.length > 0) {
      parts.push(`Likely dismiss buttons:\n${overlayMarks.join("\n")}`);
    }
    result.overlayWarning = parts.join("\n");
  }
  if (visionState) {
    result.sessionStats = {
      totalActions: visionState.totalActions,
      consecutiveNoChange: visionState.consecutiveNoChangeCount,
    };
  }
  if (dismissResult.dismissed > 0) {
    result.autoDismissed = `Auto-dismissed ${dismissResult.dismissed} overlay(s) (cookie banners, popups, etc.) before annotating.`;
  }
  const memoryLog = formatActionMemory(tenantId);
  if (memoryLog) {
    result.actionHistory = memoryLog;
  }
  if (driveResult.driveUrl) result.driveUrl = driveResult.driveUrl;
  if (driveResult.directDownloadUrl) result.downloadUrl = driveResult.directDownloadUrl;
  if (returnBase64) result.base64 = screenshotBuffer.toString("base64");

  return result;
}

export async function executeVisionAct(
  tenantId: number,
  mark: number,
  actType: "click" | "type" | "hover" | "select",
  text?: string,
  profileName?: string,
): Promise<any> {
  const config = loadBrowserConfig();
  if (!config.enabled) {
    return { success: false, error: "Browser tool is not enabled." };
  }

  const somData = tenantSomMaps.get(somMapKey(tenantId));
  if (!somData) {
    return {
      success: false,
      error: "No element map available. Run vision_browse first to annotate the page.",
      recovery: "Call browser with action='vision_browse' to get a fresh annotated screenshot before using vision_act.",
    };
  }

  const element = somData.elementMap[String(mark)];
  if (!element) {
    const availableRange = somData.totalMarks > 0 ? `0-${somData.totalMarks - 1}` : "none";
    return {
      success: false,
      error: `Mark [${mark}] not found. Available marks: ${availableRange}.`,
      recovery: "The page may have changed since the last vision_browse. Call vision_browse again to get fresh marks. The element you were targeting may have moved, been removed, or a popup may have appeared.",
    };
  }

  const session = await getTenantSession(tenantId, profileName);
  if (!checkTenantRateLimit(tenantId, config)) {
    return { success: false, error: "Rate limit reached. Wait a moment and try again." };
  }
  recordAction(session);
  const page = await getPageForSession(session);
  const urlBefore = page.url();

  const beforeBuffer = await page.screenshot({ type: "png", fullPage: false }).catch(() => null) as Buffer | null;
  const beforeHash = beforeBuffer ? computeScreenshotHash(beforeBuffer) : "";

  try {
    switch (actType) {
      case "click": {
        await humanDelay(80, 200);
        await page.mouse.click(element.x, element.y, { delay: Math.floor(Math.random() * 60) + 30 });
        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
        const clickErr = await validatePageUrlAfterAction(page, config);
        if (clickErr) return { success: false, error: clickErr };
        break;
      }
      case "type": {
        if (!text) return { success: false, error: "Text is required for type action." };
        await humanDelay(80, 200);
        await page.mouse.click(element.x, element.y);
        await humanDelay(50, 120);
        if (element.tag === "input" || element.tag === "textarea") {
          await page.evaluate(
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement;
              if (el) { el.value = ""; el.focus(); }
            },
            element.selector
          );
        }
        await page.keyboard.type(text, { delay: Math.floor(Math.random() * 50) + 30 });
        const vaTypeErr = await validatePageUrlAfterAction(page, config);
        if (vaTypeErr) return { success: false, error: vaTypeErr };
        break;
      }
      case "hover": {
        await page.mouse.move(element.x, element.y);
        await humanDelay(200, 400);
        const vaHoverErr = await validatePageUrlAfterAction(page, config);
        if (vaHoverErr) return { success: false, error: vaHoverErr };
        break;
      }
      case "select": {
        if (!text) return { success: false, error: "Value is required for select action." };
        try {
          await page.select(element.selector, text);
        } catch {
          await page.mouse.click(element.x, element.y);
          await humanDelay(100, 200);
          await page.keyboard.type(text);
        }
        const vaSelectErr = await validatePageUrlAfterAction(page, config);
        if (vaSelectErr) return { success: false, error: vaSelectErr };
        break;
      }
    }
  } catch (err: any) {
    tenantSomMaps.delete(somMapKey(tenantId));
    updateVisionState(tenantId, beforeHash, { mark, actType, text }, false);
    recordActionMemory(tenantId, {
      step: getNextStepNumber(tenantId),
      timestamp: Date.now(),
      action: actType,
      mark,
      elementTag: element.tag,
      elementText: element.text,
      elementHref: element.href || undefined,
      text,
      pageChanged: false,
      urlBefore,
      urlAfter: page.url(),
      outcome: "failed_error",
      errorMessage: err.message,
    });
    return {
      success: false,
      error: `Action failed on mark [${mark}] (${element.tag} "${element.text}"): ${err.message}`,
      recovery: "The element may have become stale or been removed by dynamic content. Call vision_browse again to get fresh marks and try a different approach. If this is a dropdown or dynamic element, try hovering first, then re-observing.",
      failedElement: { tag: element.tag, text: element.text, type: element.type },
      actionHistory: formatActionMemory(tenantId),
    };
  }

  await new Promise(r => setTimeout(r, 1200));

  const afterBuffer = await page.screenshot({ type: "png", fullPage: false }).catch(() => null) as Buffer | null;
  const afterHash = afterBuffer ? computeScreenshotHash(afterBuffer) : "changed";
  const pageChanged = beforeHash !== afterHash;

  updateVisionState(tenantId, afterHash, { mark, actType, text }, pageChanged);

  const urlAfter = page.url();
  recordActionMemory(tenantId, {
    step: getNextStepNumber(tenantId),
    timestamp: Date.now(),
    action: actType,
    mark,
    elementTag: element.tag,
    elementText: element.text,
    elementHref: element.href || undefined,
    text,
    pageChanged,
    urlBefore,
    urlAfter,
    outcome: pageChanged ? "succeeded" : "failed_no_change",
  });

  tenantSomMaps.delete(somMapKey(tenantId));

  const actionResult: any = {
    success: true,
    action: "vision_act",
    mark,
    actType,
    pageChanged,
    element: {
      tag: element.tag,
      text: element.text,
      type: element.type,
      href: element.href,
      position: { x: element.x, y: element.y },
    },
    url: urlAfter,
    title: await page.title(),
    hint: "ACTION COMPLETE — The element map is now invalidated. You MUST call vision_browse again to see the updated page state. If your objective is achieved, STOP and report results. Do NOT continue clicking without re-observing.",
    nextStep: "Call browser with action='vision_browse' to re-observe the page, or STOP if the objective is met.",
    actionHistory: formatActionMemory(tenantId),
  };

  if (!pageChanged) {
    actionResult.stateWarning = `NOTE: The page appears UNCHANGED after ${actType} on mark [${mark}] ("${element.text}"). This element may be inactive, disabled, or a no-op. When you call vision_browse next, do NOT target this same element again. Try a different approach.`;
  }

  const state = getVisionState(tenantId);
  if (state && state.totalActions >= 12) {
    actionResult.iterationWarning = `You have executed ${state.totalActions} vision actions this session. You are approaching the recommended limit of 15. Consider whether your objective is achievable or if you should report partial results and stop.`;
  }

  const mem = getActionMemory(tenantId);
  const recentFails = mem.filter(e => e.outcome !== "succeeded");
  if (recentFails.length >= 3) {
    const failedTexts = recentFails.map(e => `"${e.elementText}"`).filter((v, i, a) => a.indexOf(v) === i);
    actionResult.patternWarning = `PATTERN DETECTED: ${recentFails.length} of your last ${mem.length} actions failed. Failed elements: ${failedTexts.join(", ")}. You are making no progress. Change strategy completely: try scrolling, navigating to a different page, using a search box, or reporting that the objective cannot be completed from this page.`;
  }

  return actionResult;
}

// ─── Disconnect ────────────────────────────────────────────

export async function disconnectBrowser(): Promise<void> {
  for (const [key, session] of tenantSessions.entries()) {
    stopLiveRefresh(session.tenantId);
    try { await session.context.close(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
    tenantSessions.delete(key);
  }

  if (sharedBrowser) {
    try { await sharedBrowser.disconnect(); } catch (_silentErr) { logSilentCatch("server/browser-tool.ts", _silentErr); }
    sharedBrowser = null;
    sharedBrowserProfile = null;
  }
}

export function getActiveSessions(): Array<{
  tenantId: number;
  profile: string;
  createdAt: number;
  lastActivity: number;
  actionCount: number;
  idleSeconds: number;
}> {
  const now = Date.now();
  return Array.from(tenantSessions.values()).map(s => ({
    tenantId: s.tenantId,
    profile: s.profileName,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    actionCount: s.actionCount,
    idleSeconds: Math.floor((now - s.lastActivity) / 1000),
  }));
}
