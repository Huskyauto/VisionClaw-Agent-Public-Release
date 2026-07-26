// "Instant AI Readiness Audit" engine — autonomous fulfillment for the /audit
// wedge. Given a public website URL, fetches the site (SSRF-jailed, with every
// redirect hop re-jailed) and scores how well it is set up to be understood and
// fairly represented by AI assistants and modern search.
//
// SECURITY: every outbound fetch — homepage AND the /llms.txt, /robots.txt,
// /sitemap.xml probes — goes through ssrfSafeUrl() per request. We use
// redirect:"manual" and re-jail the Location target on each hop so a 30x to an
// internal host can never bypass the input jail (the shared ssrfSafeFetchBytes
// helper refuses redirects outright; an audit tool must tolerate the common
// http→https / apex→www redirect, hence the bounded re-jailed loop here).

import { ssrfSafeUrl } from "./lib/ssrf-jail";
import { logSilentCatch } from "./lib/silent-catch";
import { Agent } from "undici";

// Closes the DNS-rebinding TOCTOU: ssrfSafeUrl() validates the IPs the hostname
// currently resolves to, but a normal fetch() re-resolves at connect time, so a
// hostile DNS server could swap in a private IP between check and connect. This
// dispatcher overrides the socket's DNS lookup to return ONLY those already-
// validated IPs, while leaving TLS SNI + Host header bound to the real hostname.
function pinnedDispatcher(addresses: string[]): Agent {
  const mapped = addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  return new Agent({
    connect: {
      lookup: (_hostname: string, options: any, cb: any) => {
        // Return every validated IP when the caller asks for all; otherwise
        // honor a requested family (falling back to the first) so multi-address
        // hosts stay reachable while remaining pinned to validated IPs only.
        if (options && options.all) { cb(null, mapped as any); return; }
        const fam = options?.family;
        const pick = (fam === 4 || fam === 6) ? (mapped.find((m) => m.family === fam) || mapped[0]) : mapped[0];
        cb(null, pick.address, pick.family);
      },
    },
  });
}

export interface AuditCheck {
  id: string;
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  score: number;
  maxScore: number;
  detail: string;
  recommendation?: string;
}

export interface AuditResult {
  websiteUrl: string;
  finalUrl: string;
  overallScore: number;
  grade: string;
  checks: AuditCheck[];
  recommendations: string[];
  fetchedAt: string;
}

export class AuditFetchError extends Error {
  code = "AUDIT_FETCH" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuditFetchError";
  }
}

type FetchOk = { ok: true; status: number; text: string; finalUrl: string; contentType: string };
type FetchErr = { ok: false; reason: string };

const UA = "VisionClaw-Audit/1.0 (+https://agenticcorporation.net)";

// SSRF-safe fetch with manual, re-jailed redirect following + a hard byte cap.
// Exported so server/enrichment-engine.ts can reuse the exact same jailed fetch
// (security-critical — must never be duplicated/forked).
export async function safeFetchText(
  rawUrl: string,
  opts: { timeoutMs: number; maxBytes: number; maxRedirects: number },
): Promise<FetchOk | FetchErr> {
  let current = rawUrl;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const safe = await ssrfSafeUrl(current);
    if (!safe.ok) return { ok: false, reason: safe.reason };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    const dispatcher = pinnedDispatcher(safe.addresses);
    try {
      const res = await fetch(safe.url.toString(), {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,text/plain,application/xml;q=0.9,*/*;q=0.8" },
        dispatcher,
      } as any);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: `redirect ${res.status} with no Location` };
        try {
          current = new URL(loc, safe.url).toString();
        } catch {
          return { ok: false, reason: "invalid redirect target" };
        }
        continue;
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const ct = res.headers.get("content-type") || "";
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, reason: "no body stream" };
      let total = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          try { await reader.cancel(); } catch (_silentErr) { logSilentCatch("server/audit-engine.ts", _silentErr); }
          break; // cap reached — keep what we have, enough to analyze <head>
        }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return { ok: true, status: res.status, text: buf.toString("utf-8"), finalUrl: safe.url.toString(), contentType: ct };
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "timed out" : e?.message || String(e);
      return { ok: false, reason: `fetch failed: ${msg}` };
    } finally {
      clearTimeout(t);
      dispatcher.destroy().catch(() => { /* best-effort cleanup */ });
    }
  }
  return { ok: false, reason: "too many redirects" };
}

// ---- HTML parsing helpers (regex; advisory signal, not a full DOM) ----

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

interface MetaTag { name: string; property: string; content: string }
function extractMetas(html: string): MetaTag[] {
  const metas: MetaTag[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || "";
    const property = /\bproperty\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || "";
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || "";
    metas.push({ name: name.toLowerCase(), property: property.toLowerCase(), content });
  }
  return metas;
}

function metaContent(metas: MetaTag[], key: string): string | null {
  const k = key.toLowerCase();
  const hit = metas.find((x) => x.name === k || x.property === k);
  return hit && hit.content ? hit.content.trim() : null;
}

function hasCanonical(html: string): boolean {
  return /<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i.test(html);
}

function htmlLang(html: string): string | null {
  return /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z][a-zA-Z0-9-]*)/i.exec(html)?.[1] || null;
}

function extractJsonLdTypes(html: string): string[] {
  const types: string[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const collect = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(collect); return; }
        if (node["@type"]) {
          const ty = node["@type"];
          (Array.isArray(ty) ? ty : [ty]).forEach((x) => typeof x === "string" && types.push(x));
        }
        if (Array.isArray(node["@graph"])) node["@graph"].forEach(collect);
      };
      collect(parsed);
    } catch (_silentErr) { logSilentCatch("server/audit-engine.ts", _silentErr); }
  }
  return types;
}

// Known AI-assistant / answer-engine crawlers whose access governs whether your
// content can appear in AI answers.
const AI_CRAWLERS = [
  "gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "anthropic-ai",
  "claude-web", "google-extended", "perplexitybot", "ccbot", "bytespider",
  "amazonbot", "applebot-extended",
];

// Returns the list of AI crawlers explicitly disallowed from the site root.
function blockedAiCrawlers(robots: string): string[] {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  const groups: { agents: string[]; disallows: string[] }[] = [];
  let cur: { agents: string[]; disallows: string[] } | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const ua = /^user-agent:\s*(.+)$/i.exec(line);
    if (ua) {
      if (!cur || !lastWasAgent) { cur = { agents: [], disallows: [] }; groups.push(cur); }
      cur.agents.push(ua[1].trim().toLowerCase());
      lastWasAgent = true;
      continue;
    }
    const dis = /^disallow:\s*(.*)$/i.exec(line);
    if (dis && cur) cur.disallows.push(dis[1].trim());
    lastWasAgent = false;
  }
  const rootBlocked = (g: { disallows: string[] }) => g.disallows.some((d) => d === "/");
  const blocked: string[] = [];
  for (const bot of AI_CRAWLERS) {
    const grp = groups.find((g) => g.agents.includes(bot));
    if (grp && rootBlocked(grp)) blocked.push(bot);
  }
  // a blanket "User-agent: * / Disallow: /" blocks everyone including AI bots
  const star = groups.find((g) => g.agents.includes("*"));
  if (star && rootBlocked(star) && blocked.length === 0) blocked.push("* (all crawlers)");
  return blocked;
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 45) return "D";
  return "F";
}

// Normalize user input into an https URL (jail enforces https; most modern
// sites support it, and AI-readiness presumes a secure origin).
function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  s = s.replace(/^http:\/\//i, "https://");
  return s;
}

export async function runAudit(rawInput: string): Promise<AuditResult> {
  const websiteUrl = normalizeUrl(rawInput);
  const home = await safeFetchText(websiteUrl, { timeoutMs: 12000, maxBytes: 2 * 1024 * 1024, maxRedirects: 4 });
  if (!home.ok) {
    throw new AuditFetchError(`We couldn't reach that site (${home.reason}). Check that the URL is correct and publicly reachable over HTTPS.`);
  }
  const html = home.text;
  const origin = new URL(home.finalUrl).origin;

  // Probe the AI-readiness files in parallel (failures = "absent").
  const [llms, robots, sitemap] = await Promise.all([
    safeFetchText(origin + "/llms.txt", { timeoutMs: 8000, maxBytes: 256 * 1024, maxRedirects: 2 }),
    safeFetchText(origin + "/robots.txt", { timeoutMs: 8000, maxBytes: 256 * 1024, maxRedirects: 2 }),
    safeFetchText(origin + "/sitemap.xml", { timeoutMs: 8000, maxBytes: 256 * 1024, maxRedirects: 2 }),
  ]);

  const metas = extractMetas(html);
  const title = extractTitle(html);
  const desc = metaContent(metas, "description");
  const ogTitle = metaContent(metas, "og:title");
  const ogDesc = metaContent(metas, "og:description");
  const ogImage = metaContent(metas, "og:image");
  const twitterCard = metaContent(metas, "twitter:card");
  const viewport = metaContent(metas, "viewport");
  const lang = htmlLang(html);
  const canonical = hasCanonical(html);
  const jsonLdTypes = extractJsonLdTypes(html);
  const orgTypes = ["organization", "localbusiness", "corporation", "professionalservice", "store", "product", "website", "webpage"];
  const hasOrgSchema = jsonLdTypes.some((t) => orgTypes.includes(t.toLowerCase()));

  const checks: AuditCheck[] = [];

  // ---- AI Access (35) ----
  const llmsOk = llms.ok && llms.text.trim().length > 20;
  checks.push({
    id: "llms_txt", label: "llms.txt file", category: "AI Access", maxScore: 20,
    status: llmsOk ? "pass" : llms.ok ? "warn" : "fail",
    score: llmsOk ? 20 : llms.ok ? 8 : 0,
    detail: llmsOk ? "Found a populated /llms.txt — AI assistants get a curated guide to your site."
      : llms.ok ? "An /llms.txt exists but is nearly empty." : "No /llms.txt found.",
    recommendation: llmsOk ? undefined : "Add an /llms.txt at your site root describing your business, key pages, products, and contact info so AI assistants represent you accurately.",
  });

  const blockedBots = robots.ok ? blockedAiCrawlers(robots.text) : [];
  checks.push({
    id: "ai_crawlers", label: "AI crawler access", category: "AI Access", maxScore: 15,
    status: blockedBots.length > 0 ? "fail" : robots.ok ? "pass" : "warn",
    score: blockedBots.length > 0 ? 0 : robots.ok ? 15 : 9,
    detail: blockedBots.length > 0 ? `robots.txt blocks AI assistants from your content: ${blockedBots.join(", ")}.`
      : robots.ok ? "robots.txt is present and does not block major AI assistants." : "No robots.txt found (crawlers default to allowed, but nothing is explicit).",
    recommendation: blockedBots.length > 0 ? "If you want to appear in AI answers, stop blocking assistant crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot) at your site root in robots.txt."
      : robots.ok ? undefined : "Add a robots.txt that explicitly allows the AI assistant crawlers you care about and points to your sitemap.",
  });

  // ---- Structured Data (20) ----
  checks.push({
    id: "json_ld", label: "Structured data (schema.org)", category: "Structured Data", maxScore: 20,
    status: hasOrgSchema ? "pass" : jsonLdTypes.length > 0 ? "warn" : "fail",
    score: hasOrgSchema ? 20 : jsonLdTypes.length > 0 ? 12 : 0,
    detail: hasOrgSchema ? `Found JSON-LD with a business/identity type (${jsonLdTypes.slice(0, 4).join(", ")}).`
      : jsonLdTypes.length > 0 ? `JSON-LD present (${jsonLdTypes.slice(0, 4).join(", ")}) but no Organization/LocalBusiness identity block.`
      : "No JSON-LD structured data found.",
    recommendation: hasOrgSchema ? undefined : "Add schema.org JSON-LD — at minimum an Organization or LocalBusiness block — so AI and search engines reliably know who you are, where, and what you offer.",
  });

  // ---- Metadata (20) ----
  const titleOk = !!title && title.length >= 10 && title.length <= 70;
  checks.push({
    id: "title", label: "Page title", category: "Metadata", maxScore: 7,
    status: titleOk ? "pass" : title ? "warn" : "fail",
    score: titleOk ? 7 : title ? 4 : 0,
    detail: title ? `Title: "${title.slice(0, 80)}" (${title.length} chars).` : "No <title> tag found.",
    recommendation: titleOk ? undefined : "Set a clear, descriptive <title> of roughly 10–70 characters that names your business and what you do.",
  });
  const descOk = !!desc && desc.length >= 50 && desc.length <= 160;
  checks.push({
    id: "meta_description", label: "Meta description", category: "Metadata", maxScore: 8,
    status: descOk ? "pass" : desc ? "warn" : "fail",
    score: descOk ? 8 : desc ? 4 : 0,
    detail: desc ? `Description present (${desc.length} chars).` : "No meta description found.",
    recommendation: descOk ? undefined : "Add a meta description of ~50–160 characters summarizing your business — it's often what AI and search show as your snippet.",
  });
  checks.push({
    id: "canonical", label: "Canonical URL", category: "Metadata", maxScore: 5,
    status: canonical ? "pass" : "fail",
    score: canonical ? 5 : 0,
    detail: canonical ? "Canonical link present." : "No canonical <link> found.",
    recommendation: canonical ? undefined : "Add a <link rel=\"canonical\"> so crawlers consolidate duplicate URLs to one authoritative page.",
  });

  // ---- Social / Sharing (15) ----
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  checks.push({
    id: "open_graph", label: "Open Graph tags", category: "Social", maxScore: 10,
    status: ogCount === 3 ? "pass" : ogCount > 0 ? "warn" : "fail",
    score: ogCount === 3 ? 10 : ogCount > 0 ? 5 : 0,
    detail: `${ogCount}/3 core Open Graph tags present (og:title, og:description, og:image).`,
    recommendation: ogCount === 3 ? undefined : "Add og:title, og:description and og:image so your links render rich previews when shared or cited.",
  });
  checks.push({
    id: "twitter_card", label: "Twitter/X card", category: "Social", maxScore: 5,
    status: twitterCard ? "pass" : "fail",
    score: twitterCard ? 5 : 0,
    detail: twitterCard ? `twitter:card = ${twitterCard}.` : "No twitter:card meta found.",
    recommendation: twitterCard ? undefined : "Add a twitter:card meta tag (summary_large_image) for better link previews on X.",
  });

  // ---- Technical (10) ----
  checks.push({
    id: "https", label: "HTTPS", category: "Technical", maxScore: 4,
    status: "pass", score: 4,
    detail: "Site served over HTTPS.",
  });
  checks.push({
    id: "viewport", label: "Mobile viewport", category: "Technical", maxScore: 3,
    status: viewport ? "pass" : "fail",
    score: viewport ? 3 : 0,
    detail: viewport ? "Responsive viewport meta present." : "No mobile viewport meta found.",
    recommendation: viewport ? undefined : "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> for mobile rendering.",
  });
  checks.push({
    id: "lang", label: "Language declaration", category: "Technical", maxScore: 3,
    status: lang ? "pass" : "fail",
    score: lang ? 3 : 0,
    detail: lang ? `<html lang="${lang}"> declared.` : "No lang attribute on <html>.",
    recommendation: lang ? undefined : "Declare a language on the <html> element (e.g. lang=\"en\") so assistants interpret your content correctly.",
  });

  // sitemap is folded into the AI-access narrative as a bonus signal on robots,
  // but we surface it as its own informational check for actionability.
  checks.push({
    id: "sitemap", label: "XML sitemap", category: "Discoverability", maxScore: 0,
    status: sitemap.ok ? "pass" : "warn",
    score: 0,
    detail: sitemap.ok ? "sitemap.xml found at the site root." : "No sitemap.xml at the site root (it may live elsewhere).",
    recommendation: sitemap.ok ? undefined : "Publish a sitemap.xml and reference it in robots.txt so crawlers discover every page.",
  });

  const overallScore = Math.round(checks.reduce((s, c) => s + c.score, 0));
  const recommendations = checks
    .filter((c) => c.status !== "pass" && c.recommendation)
    .sort((a, b) => (b.maxScore - b.score) - (a.maxScore - a.score))
    .slice(0, 6)
    .map((c) => c.recommendation!) as string[];

  return {
    websiteUrl,
    finalUrl: home.finalUrl,
    overallScore,
    grade: gradeFor(overallScore),
    checks,
    recommendations,
    fetchedAt: new Date().toISOString(),
  };
}
