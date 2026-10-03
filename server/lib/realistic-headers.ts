import type { IncomingHttpHeaders } from "http";

let _generator: any | null = null;
let _initFailed = false;
let _initPromise: Promise<any | null> | null = null;
let _hits = 0;
let _fallbacks = 0;

async function getGenerator(): Promise<any | null> {
  if (_generator || _initFailed) return _generator;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const mod: any = await import("header-generator");
      const HeaderGenerator = mod.HeaderGenerator || mod.default?.HeaderGenerator || mod.default;
      if (typeof HeaderGenerator !== "function") {
        console.warn("[realistic-headers] header-generator export shape unexpected; disabling");
        _initFailed = true;
        return null;
      }
      _generator = new HeaderGenerator({
        browsers: [
          { name: "chrome", minVersion: 118 },
          { name: "firefox", minVersion: 119 },
          { name: "safari", minVersion: 16 },
        ],
        devices: ["desktop"],
        operatingSystems: ["windows", "macos", "linux"],
        locales: ["en-US", "en"],
      });
      return _generator;
    } catch (err: any) {
      console.warn(`[realistic-headers] init failed (will use static UA fallback): ${err?.message || err}`);
      _initFailed = true;
      return null;
    }
  })();
  return _initPromise;
}

const STATIC_FALLBACK: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; VisionClaw/1.0)",
  "Accept": "text/html,text/plain,application/json",
};

export async function getRealisticHeaders(opts?: {
  url?: string;
  acceptOverride?: string;
}): Promise<Record<string, string>> {
  const enabled = process.env.WEB_ACCESS_TIER1_REALISTIC_HEADERS !== "0";
  if (!enabled) {
    _fallbacks++;
    return { ...STATIC_FALLBACK, ...(opts?.acceptOverride ? { Accept: opts.acceptOverride } : {}) };
  }
  const gen = await getGenerator();
  if (!gen) {
    _fallbacks++;
    return { ...STATIC_FALLBACK, ...(opts?.acceptOverride ? { Accept: opts.acceptOverride } : {}) };
  }
  try {
    const headers: IncomingHttpHeaders = gen.getHeaders({ url: opts?.url });
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === "string") out[k] = v;
    }
    if (opts?.acceptOverride) out["Accept"] = opts.acceptOverride;
    // Pin Accept-Encoding to encodings Node's undici decodes natively (architect R112.17 +sec rec)
    // — eliminates rare decode-incompatibility outages from exotic encodings the generator might pick.
    out["Accept-Encoding"] = "gzip, deflate, br";
    _hits++;
    return out;
  } catch (err: any) {
    console.warn(`[realistic-headers] generation failed for ${opts?.url}; using static fallback: ${err?.message || err}`);
    _fallbacks++;
    return { ...STATIC_FALLBACK, ...(opts?.acceptOverride ? { Accept: opts.acceptOverride } : {}) };
  }
}

export function getRealisticHeadersStats(): { hits: number; fallbacks: number; ratio: number } {
  const total = _hits + _fallbacks;
  return { hits: _hits, fallbacks: _fallbacks, ratio: total ? _hits / total : 0 };
}
