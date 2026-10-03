import fs from "fs";
import path from "path";
import { logSilentCatch } from "./lib/silent-catch";

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
