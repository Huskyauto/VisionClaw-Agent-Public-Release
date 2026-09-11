// "Smart Lead Enrichment" engine — autonomous fulfillment for the /enrichment
// wedge (IdeaBrowser project #247, "turn a contact form into a lead-enrichment
// experience"). Given a work email (and optional company domain), it fetches the
// company's public site (SSRF-jailed via the shared audit-engine fetch, redirects
// re-jailed per hop) and synthesizes a B2B lead-intelligence card with an LLM:
// company summary, industry, size, buying signals, ICP-fit score, suggested
// talking points, likely decision-makers, and a hot/warm/cold routing call.
//
// SECURITY: every outbound fetch reuses safeFetchText() from audit-engine.ts —
// the exact same jailed fetch (ssrfSafeUrl + pinned-IP dispatcher + manual
// re-jailed redirects + byte cap). We never fork that code.

import { safeFetchText } from "./audit-engine";
import { executeWithFailover } from "./model-failover";
import { getAvailableModels } from "./providers";

export interface EnrichmentSignal {
  label: string;
  value: string;
}

export interface EnrichmentResult {
  inputEmail: string | null;
  companyDomain: string;
  finalUrl: string;
  companyName: string;
  oneLiner: string;
  industry: string;
  estimatedSize: string;
  signals: EnrichmentSignal[];
  icpFitScore: number; // 0–100, fit for a B2B-SaaS automation buyer
  routing: "hot" | "warm" | "cold";
  talkingPoints: string[];
  decisionMakers: string[];
  summary: string;
  modelUsed: string;
  fetchedAt: string;
}

export class EnrichmentFetchError extends Error {
  code = "ENRICH_FETCH" as const;
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentFetchError";
  }
}

// Free / personal mailbox providers — these carry no company to enrich, so we
// fail fast with an actionable message instead of fetching gmail.com et al.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "yandex.ru", "fastmail.com",
]);

// Resolve a company domain from either a raw domain or a work-email address.
// Returns null when we can't derive a usable corporate domain.
export function deriveCompanyDomain(emailOrDomain: string, explicitDomain?: string | null): string | null {
  const explicit = (explicitDomain || "").trim().toLowerCase();
  if (explicit) {
    const host = cleanHost(explicit);
    if (host && host.includes(".")) return host;
  }
  const raw = (emailOrDomain || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("@")) {
    const dom = raw.slice(raw.lastIndexOf("@") + 1).trim();
    if (!dom || !dom.includes(".")) return null;
    if (FREE_EMAIL_DOMAINS.has(dom)) return null;
    return cleanHost(dom);
  }
  // Treat the whole input as a domain/URL.
  const host = cleanHost(raw);
  if (host && host.includes(".") && !FREE_EMAIL_DOMAINS.has(host)) return host;
  return null;
}

function cleanHost(s: string): string {
  return s
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .trim();
}

export function isFreeEmailDomain(email: string): boolean {
  const raw = (email || "").trim().toLowerCase();
  if (!raw.includes("@")) return false;
  const dom = raw.slice(raw.lastIndexOf("@") + 1).trim();
  return FREE_EMAIL_DOMAINS.has(dom);
}

// Strip HTML to a compact text blob the LLM can read. Drops script/style, tags,
// and collapses whitespace; decodes the handful of entities that matter.
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clampScore(n: any): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function routingFor(score: number, given?: any): "hot" | "warm" | "cold" {
  const g = String(given || "").toLowerCase();
  if (g === "hot" || g === "warm" || g === "cold") return g as any;
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function asStringArray(v: any, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function asSignals(v: any, cap: number): EnrichmentSignal[] {
  if (!Array.isArray(v)) return [];
  const out: EnrichmentSignal[] = [];
  for (const item of v) {
    if (out.length >= cap) break;
    if (item && typeof item === "object" && (item.label || item.value)) {
      out.push({ label: String(item.label || "").trim().slice(0, 80), value: String(item.value || "").trim().slice(0, 240) });
    } else if (typeof item === "string" && item.trim()) {
      out.push({ label: "Signal", value: item.trim().slice(0, 240) });
    }
  }
  return out.filter((s) => s.label || s.value);
}

// Pull the first balanced JSON object out of a model response (handles models
// that wrap JSON in prose or ```json fences).
function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const SYS_PROMPT =
  "You are a senior B2B sales-development researcher. From a company's public " +
  "website text you produce a concise, accurate lead-intelligence card for a " +
  "sales rep. NEVER invent specific facts (funding amounts, headcount, names) " +
  "that are not supported by the text — if unknown, say so or estimate a range " +
  "and label it an estimate. The product being sold is an AI automation / " +
  "intelligent-lead-enrichment platform priced at $99–$499/mo, whose ICP is " +
  "B2B SaaS and digital-service companies that run inbound contact/demo forms. " +
  "Score icpFitScore 0–100 for how well THIS company fits that ICP. " +
  'Respond with ONLY a JSON object of this exact shape: {"companyName":string,' +
  '"oneLiner":string,"industry":string,"estimatedSize":string,"signals":' +
  '[{"label":string,"value":string}],"icpFitScore":number,"routing":' +
  '"hot"|"warm"|"cold","talkingPoints":[string],"decisionMakers":[string],' +
  '"summary":string}. talkingPoints = 3–5 specific openers a rep could use. ' +
  "decisionMakers = the job TITLES most likely to own this purchase here.";

export async function runEnrichment(
  rawEmailOrDomain: string,
  opts: { explicitDomain?: string | null; tenantId: number },
): Promise<EnrichmentResult> {
  const inputEmail = rawEmailOrDomain.includes("@") ? rawEmailOrDomain.trim() : null;
  const domain = deriveCompanyDomain(rawEmailOrDomain, opts.explicitDomain);
  if (!domain) {
    throw new EnrichmentFetchError(
      "That looks like a personal email (or we couldn't read a company domain). Use a work email — or enter your company website — so we can research the company behind it.",
    );
  }

  const home = await safeFetchText("https://" + domain, {
    timeoutMs: 12000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 4,
  });
  if (!home.ok) {
    throw new EnrichmentFetchError(
      `We couldn't reach ${domain} (${home.reason}). Check the domain is correct and publicly reachable over HTTPS.`,
    );
  }
  const origin = new URL(home.finalUrl).origin;

  // Best-effort secondary pages for richer context (failures are fine).
  const [about, pricing] = await Promise.all([
    safeFetchText(origin + "/about", { timeoutMs: 8000, maxBytes: 512 * 1024, maxRedirects: 2 }),
    safeFetchText(origin + "/pricing", { timeoutMs: 8000, maxBytes: 512 * 1024, maxRedirects: 2 }),
  ]);

  const parts: string[] = [`HOMEPAGE (${home.finalUrl}):\n` + htmlToText(home.text).slice(0, 6000)];
  if (about.ok) parts.push(`ABOUT:\n` + htmlToText(about.text).slice(0, 2500));
  if (pricing.ok) parts.push(`PRICING:\n` + htmlToText(pricing.text).slice(0, 2000));
  const corpus = parts.join("\n\n");

  if (corpus.replace(/\s/g, "").length < 60) {
    throw new EnrichmentFetchError(
      `We reached ${domain} but couldn't read enough public text to research it (it may be a JS-only app or behind a login).`,
    );
  }

  const availableModels = await getAvailableModels();
  // Prefer the free Replit OpenAI lane; failover handles the rest.
  const preferred =
    availableModels.find((m: any) => m.provider === "openai")?.id ||
    availableModels[0]?.id ||
    "gpt-5-mini";

  let raw = "";
  let modelUsed = preferred;
  try {
    const { result, usedModel } = await executeWithFailover(
      preferred,
      availableModels,
      async (client: any, modelId: string) => {
        return client.chat.completions.create({
          model: modelId,
          messages: [
            { role: "system", content: SYS_PROMPT },
            {
              role: "user",
              content: `Company domain: ${domain}\n\nPublic website text:\n${corpus}\n\nReturn the lead-intelligence JSON now.`,
            },
          ],
          max_completion_tokens: 1100,
        });
      },
      opts.tenantId,
    );
    modelUsed = usedModel || preferred;
    raw = result?.choices?.[0]?.message?.content || "";
  } catch (e: any) {
    throw new EnrichmentFetchError(
      `We reached ${domain} but the research step failed (${e?.message || "model error"}). Please try again in a moment.`,
    );
  }

  const parsed = extractJsonObject(raw);
  if (!parsed) {
    throw new EnrichmentFetchError(
      `We reached ${domain} but couldn't structure the research. Please try again.`,
    );
  }

  const icpFitScore = clampScore(parsed.icpFitScore);
  return {
    inputEmail,
    companyDomain: domain,
    finalUrl: home.finalUrl,
    companyName: String(parsed.companyName || domain).trim().slice(0, 200) || domain,
    oneLiner: String(parsed.oneLiner || "").trim().slice(0, 300),
    industry: String(parsed.industry || "Unknown").trim().slice(0, 120),
    estimatedSize: String(parsed.estimatedSize || "Unknown").trim().slice(0, 120),
    signals: asSignals(parsed.signals, 8),
    icpFitScore,
    routing: routingFor(icpFitScore, parsed.routing),
    talkingPoints: asStringArray(parsed.talkingPoints, 6),
    decisionMakers: asStringArray(parsed.decisionMakers, 6),
    summary: String(parsed.summary || "").trim().slice(0, 1500),
    modelUsed,
    fetchedAt: new Date().toISOString(),
  };
}
