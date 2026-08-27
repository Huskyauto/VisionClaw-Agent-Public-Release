/**
 * Public-API tool pack (R125+35) — extracted from Agenvoy's `extensions/apis/`
 * (pardnchiu/Agenvoy, Apache-2.0). Agenvoy ships JSON specs for a handful of
 * free, no-auth, read-only public APIs; this is the VisionClaw-native, security-
 * hardened port of that idea.
 *
 * DESIGN INVARIANTS (why this is SSRF-safe despite network: external):
 *  - The HOST of every request is HARDCODED here. The LLM never controls the
 *    host, scheme, port, or path prefix — only constrained query parameters.
 *  - Every LLM-supplied param is validated against a tight allowlist regex AND
 *    encodeURIComponent'd before interpolation, so it cannot break out of the
 *    query string to redirect the request to a metadata endpoint / RFC1918 host.
 *  - Therefore the classic SSRF surface (LLM-controlled URL) does not exist; the
 *    url-guard isSafeUrl/isSafeDns layer (for tools that DO take an LLM URL) is
 *    not applicable here. See tests/public-api-tools.test.ts for host-injection
 *    rejection cases.
 *  - Every function returns { ok, ... } | { ok:false, error } and NEVER throws —
 *    the chat-engine treats throws as user-visible errors.
 *  - Responses are size-capped and time-bounded. Text-bearing fields (Wikipedia
 *    extract, HN titles) are returned as data to the executor, which fences them
 *    via wrapExternalContent before they reach the model (prompt-injection
 *    defense, mirroring the academic_search +sec pattern).
 *
 * All six are classified `safe`/`LOW` in destructive-tool-policy.ts: read-only,
 * idempotent, no money, no PII writes, no tenant data.
 */

import { isIP } from "node:net";
import dns from "node:dns/promises";
import { blockedIpReason } from "./lib/ssrf-jail";
import { logSilentCatch } from "./lib/silent-catch";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 256 * 1024;
const UA = "VisionClaw/1.0 (+https://agenticcorporation.net)";

export interface PublicApiOk {
  ok: true;
  source: string;
  data: any;
}
export interface PublicApiErr {
  ok: false;
  error: string;
}
export type PublicApiResult = PublicApiOk | PublicApiErr;

// DNS-rebinding defense: even an allowlisted hostname must not resolve to a
// private/internal/metadata address. A trusted public-API domain whose DNS is
// poisoned (or that turns hostile) could otherwise point at 169.254.169.254 or
// an RFC1918 host. Mirrors browser-tool's isUrlAllowedWithDns: resolve A+AAAA,
// reject any private address, and fail CLOSED if the host does not resolve.
async function assertHostResolvesPublic(host: string): Promise<void> {
  // Use the SSRF jail's blockedIpReason as the single source of truth for IP
  // classification — it handles IPv4-mapped IPv6 hex forms (::ffff:7f00:1),
  // CGNAT, benchmark, ULA, etc. that a looser classifier misses. Strip any
  // IPv6 brackets first so the literal is seen.
  const stripBrackets = (h: string) => h.replace(/^\[/, "").replace(/\]$/, "");
  if (isIP(host)) {
    const reason = blockedIpReason(stripBrackets(host));
    if (reason) throw new Error(`host ${host} is a private/reserved address (${reason})`);
    return;
  }
  const addrs: string[] = [];
  try { addrs.push(...(await dns.resolve4(host))); } catch (e) { logSilentCatch("server/public-api-tools.ts", e); }
  try { addrs.push(...(await dns.resolve6(host))); } catch (e) { logSilentCatch("server/public-api-tools.ts", e); }
  if (addrs.length === 0) throw new Error(`host ${host} did not resolve`);
  for (const addr of addrs) {
    const reason = blockedIpReason(stripBrackets(addr));
    if (reason) throw new Error(`host ${host} resolves to a private/reserved address (${addr}: ${reason})`);
  }
}

// Host-locked GET. `allowedHosts` enumerates the ONLY hostnames a request (and
// any redirect it follows) may land on. Redirects are followed MANUALLY, one hop
// at a time, and EVERY hop's host + resolved IPs are re-validated BEFORE the
// request is issued — so a maliciously-crafted upstream 30x can never make fetch
// silently issue an intermediate request to an internal/metadata host (the hole
// that `redirect:"follow"` + a post-hoc final-host check leaves open). Wikipedia
// normalizes titles via 30x to the same host, so a bounded loop is required.
const MAX_REDIRECT_HOPS = 4;
async function safeGetJson(url: string, allowedHosts: string[]): Promise<any> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const host = new URL(current).hostname.toLowerCase();
    if (!allowedHosts.includes(host)) throw new Error(`host ${host} not in allowlist`);
    await assertHostResolvesPublic(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(current, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        if (!loc) throw new Error(`redirect ${resp.status} without Location header`);
        // Resolve relative redirects against the current URL, then re-validate
        // the next hop at the top of the loop before issuing it.
        current = new URL(loc, current).toString();
        if (!/^https:\/\//i.test(current)) throw new Error(`redirect to non-https target`);
        continue;
      }
      if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}`);
      const text = await resp.text();
      if (text.length > MAX_BYTES) throw new Error("upstream response exceeded size cap");
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}

function reqStr(v: any, label: string, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new Error(`${label} is required`);
  if (s.length > max) throw new Error(`${label} too long (max ${max})`);
  return s;
}

function clampInt(v: any, def: number, lo: number, hi: number): number {
  const n = Number.parseInt(String(v ?? def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

// ───────────────────────── 1. Weather (open-meteo) ─────────────────────────
export async function fetchWeather(params: Record<string, any>): Promise<PublicApiResult> {
  try {
    const city = reqStr(params.city ?? params.location, "city", 120);
    const geo = await safeGetJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      ["geocoding-api.open-meteo.com"],
    );
    const hit = Array.isArray(geo?.results) ? geo.results[0] : undefined;
    if (!hit) return { ok: false, error: `No location found for "${city}"` };
    const fc = await safeGetJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(hit.latitude))}&longitude=${encodeURIComponent(String(hit.longitude))}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&timezone=auto`,
      ["api.open-meteo.com"],
    );
    return {
      ok: true,
      source: "open-meteo.com",
      data: {
        location: hit.name,
        admin1: hit.admin1,
        country: hit.country,
        latitude: hit.latitude,
        longitude: hit.longitude,
        timezone: fc?.timezone,
        units: fc?.current_units,
        current: fc?.current,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `fetch_weather failed: ${e?.message || String(e)}` };
  }
}

// ─────────────────────── 2. Crypto price (coingecko) ───────────────────────
export async function fetchCryptoPrice(params: Record<string, any>): Promise<PublicApiResult> {
  try {
    const idsRaw = reqStr(params.ids ?? params.coin ?? params.coins, "ids", 200);
    if (!/^[a-z0-9 ,_-]+$/i.test(idsRaw)) {
      return { ok: false, error: "ids may only contain letters, digits, commas, spaces, hyphens, underscores (e.g. 'bitcoin,ethereum')" };
    }
    const ids = idsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 25)
      .join(",");
    const vsRaw = typeof params.vs_currency === "string" ? params.vs_currency.trim().toLowerCase() : "usd";
    if (!/^[a-z]{2,8}$/.test(vsRaw)) {
      return { ok: false, error: "vs_currency must be a 2-8 letter code (e.g. 'usd', 'eur')" };
    }
    const data = await safeGetJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vsRaw)}&include_24hr_change=true`,
      ["api.coingecko.com"],
    );
    if (!data || Object.keys(data).length === 0) {
      return { ok: false, error: `No prices found for ids="${ids}" (use CoinGecko ids like 'bitcoin', not symbols like 'BTC')` };
    }
    return { ok: true, source: "coingecko.com", data: { vs_currency: vsRaw, prices: data } };
  } catch (e: any) {
    return { ok: false, error: `fetch_crypto_price failed: ${e?.message || String(e)}` };
  }
}

// ─────────────────── 3. Exchange rate (open.er-api.com) ─────────────────────
export async function fetchExchangeRate(params: Record<string, any>): Promise<PublicApiResult> {
  try {
    const baseRaw = (typeof params.base === "string" ? params.base.trim() : "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(baseRaw)) {
      return { ok: false, error: "base must be a 3-letter ISO currency code (e.g. 'USD')" };
    }
    let target: string | undefined;
    if (params.target !== undefined && params.target !== null && String(params.target).trim()) {
      target = String(params.target).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(target)) {
        return { ok: false, error: "target must be a 3-letter ISO currency code (e.g. 'EUR')" };
      }
    }
    const data = await safeGetJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(baseRaw)}`, ["open.er-api.com"]);
    if (data?.result !== "success" || !data?.rates) {
      return { ok: false, error: `No exchange rates found for base="${baseRaw}"` };
    }
    if (target) {
      const rate = data.rates[target];
      if (rate === undefined) return { ok: false, error: `No rate for ${baseRaw}->${target}` };
      return { ok: true, source: "open.er-api.com", data: { base: baseRaw, target, rate, last_update: data.time_last_update_utc } };
    }
    return { ok: true, source: "open.er-api.com", data: { base: baseRaw, last_update: data.time_last_update_utc, rates: data.rates } };
  } catch (e: any) {
    return { ok: false, error: `fetch_exchange_rate failed: ${e?.message || String(e)}` };
  }
}

// ───────────────────────── 4. Wikipedia summary ─────────────────────────────
export async function fetchWikipedia(params: Record<string, any>): Promise<PublicApiResult> {
  try {
    const title = reqStr(params.title ?? params.query ?? params.q, "title", 200);
    const slug = encodeURIComponent(title.replace(/\s+/g, "_"));
    const data = await safeGetJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, ["en.wikipedia.org"]);
    if (!data || data.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found") {
      return { ok: false, error: `No Wikipedia article found for "${title}"` };
    }
    return {
      ok: true,
      source: "en.wikipedia.org",
      data: {
        title: data.title,
        description: data.description,
        extract: data.extract,
        url: data?.content_urls?.desktop?.page,
        thumbnail: data?.thumbnail?.source,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `fetch_wikipedia failed: ${e?.message || String(e)}` };
  }
}

// ───────────────────── 5. Hacker News (HN Algolia) ──────────────────────────
export async function fetchHackerNews(params: Record<string, any>): Promise<PublicApiResult> {
  try {
    const count = clampInt(params.count ?? params.limit, 10, 1, 30);
    const hasQuery = typeof params.query === "string" && params.query.trim().length > 0;
    let url: string;
    if (hasQuery) {
      const q = params.query.trim().slice(0, 120);
      url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${count}`;
    } else {
      url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${count}`;
    }
    const data = await safeGetJson(url, ["hn.algolia.com"]);
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    const stories = hits.map((h: any) => ({
      title: h.title || h.story_title,
      url: h.url || h.story_url,
      points: h.points,
      author: h.author,
      num_comments: h.num_comments,
      created_at: h.created_at,
      hn_url: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : undefined,
    }));
    return { ok: true, source: "hn.algolia.com", data: { query: hasQuery ? params.query.trim() : "front_page", count: stories.length, stories } };
  } catch (e: any) {
    return { ok: false, error: `fetch_hacker_news failed: ${e?.message || String(e)}` };
  }
}

// ───────────────────────── 6. IP geolocation ────────────────────────────────
export async function lookupIpGeo(params: Record<string, any>): Promise<PublicApiResult> {
  try {
    // `ip` is REQUIRED. An omitted ip used to query ipwho.is with an empty
    // path, which returns the SERVER's own public IP + ISP/org — infra
    // self-identification leaked to every caller of this tool pack. Require an
    // explicit address so the tool can never disclose our own infrastructure.
    if (params.ip === undefined || params.ip === null || !String(params.ip).trim()) {
      return { ok: false, error: "ip is required: provide a valid IPv4 or IPv6 address to geolocate" };
    }
    const ip = String(params.ip).trim();
    // Strict parse via node:net.isIP (returns 0 for invalid, 4 or 6 for valid).
    if (isIP(ip) === 0) return { ok: false, error: "ip must be a valid IPv4 or IPv6 address" };
    const ipPath = encodeURIComponent(ip);
    const data = await safeGetJson(`https://ipwho.is/${ipPath}`, ["ipwho.is"]);
    if (data?.success === false) {
      return { ok: false, error: `IP lookup failed: ${data?.message || "unknown"}` };
    }
    return {
      ok: true,
      source: "ipwho.is",
      data: {
        ip: data.ip,
        type: data.type,
        city: data.city,
        region: data.region,
        country: data.country,
        country_code: data.country_code,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data?.timezone?.id,
        connection_org: data?.connection?.org,
        connection_isp: data?.connection?.isp,
      },
    };
  } catch (e: any) {
    return { ok: false, error: `lookup_ip_geo failed: ${e?.message || String(e)}` };
  }
}

export const PUBLIC_API_HANDLERS: Record<string, (p: Record<string, any>) => Promise<PublicApiResult>> = {
  fetch_weather: fetchWeather,
  fetch_crypto_price: fetchCryptoPrice,
  fetch_exchange_rate: fetchExchangeRate,
  fetch_wikipedia: fetchWikipedia,
  fetch_hacker_news: fetchHackerNews,
  lookup_ip_geo: lookupIpGeo,
};
