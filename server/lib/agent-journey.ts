import { load } from "cheerio";
import { logSilentCatch } from "./silent-catch";
import type { AgentJourneyCheck, AgentJourneyEvidence, AgentJourneyResult } from "../../shared/agent-journey";

export interface JourneyPage { url: string; html: string; truncated?: boolean }
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const LIMITATIONS = [
  "Read-only website evidence pilot, not a live assistant or completed booking test. No forms were submitted, links activated, scripts executed, purchases made or personal information sent.",
  "Only captured server-rendered pages were assessed. Missing evidence means not found in this sample, not absent from the entire business. Structured data is a website claim, not independently verified.",
  "English-language static signals only. Client-rendered content, stylesheet visibility rules and deeper pages may require a separate manual review.",
];

/** Only display public HTTP(S) identities; never retain query credentials. */
export function journeyUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.search = ""; url.hash = "";
    return url.href;
  } catch { return null; }
}

type JourneyFetch = (url: string, options: { timeoutMs: number; maxBytes: number; maxRedirects: number }) =>
  Promise<{ ok: true; text: string; finalUrl: string; contentType?: string; truncated?: boolean } | { ok: false; reason: string }>;

/** Fetch only two explicit same-origin information paths, never action links. */
export async function collectAgentJourney(home: JourneyPage, fetchText: JourneyFetch): Promise<AgentJourneyResult> {
  const pages = [home], coverage: string[] = [], candidates = new Set<string>();
  if (home.truncated) coverage.push("Homepage exceeded the retrieval byte cap; evidence coverage is incomplete.");
  const base = journeyUrl(home.url);
  if (!base) return analyzeAgentJourney([], ["The homepage URL could not be safely represented."]);
  const $ = load(home.html.slice(0, 2 * 1024 * 1024));
  $("a[href]").slice(0, 200).each((_, element) => {
    try {
      const url = new URL($(element).attr("href")!, base);
      if (url.origin !== new URL(base).origin || url.username || url.password || url.search || url.hash ||
          !/^\/(?:services?|contact(?:-us)?|pricing|locations?|hours|about(?:-us)?)\/?$/i.test(url.pathname)) return;
      if (url.href !== base) candidates.add(url.href);
    } catch (error) { logSilentCatch("agent-journey:invalid-link", error, "expected"); }
  });
  if (candidates.size > 2) coverage.push("More information links were available; this pilot inspected at most two linked pages.");
  for (const url of [...candidates].slice(0, 2)) {
    try {
      const result = await fetchText(url, { timeoutMs: 6000, maxBytes: 100_000, maxRedirects: 0 });
      if (result.ok && journeyUrl(result.finalUrl) === url &&
          (!result.contentType || /(?:text\/html|application\/xhtml\+xml)/i.test(result.contentType))) {
        pages.push({ url, html: result.text });
        if (result.truncated) coverage.push(`Information page exceeded the retrieval byte cap: ${url}. Evidence coverage is incomplete.`);
      } else coverage.push(`Information page could not be inspected: ${url}. No conclusion was drawn from the retrieval failure.`);
    } catch {
      coverage.push(`Information page could not be inspected: ${url}. No conclusion was drawn from the retrieval failure.`);
    }
  }
  return analyzeAgentJourney(pages, coverage);
}

/** Pure evidence inspection. HTML is data, never instructions or executable code. */
export function analyzeAgentJourney(pages: JourneyPage[], coverage: string[] = []): AgentJourneyResult {
  const evidence: Record<AgentJourneyCheck["id"], AgentJourneyEvidence[]> = {
    services: [], area_hours: [], pricing: [], contact_route: [], requirements: [],
  };
  let area = false, hours = false, price = false, quote = false, localRoute = false, externalRoute = false;
  const add = (id: AgentJourneyCheck["id"], url: string, text: string) => {
    const excerpt = clean(text).slice(0, 360);
    if (excerpt && evidence[id].length < 4 && !evidence[id].some(e => e.url === url && e.excerpt === excerpt))
      evidence[id].push({ url, excerpt });
  };
  const assessed: string[] = [];
  for (const page of pages.slice(0, 3)) {
    const url = journeyUrl(page.url);
    if (!url) continue;
    assessed.push(url);
    const $ = load(page.html.slice(0, 2 * 1024 * 1024));
    // Parse only JSON, with bounded depth/work; never evaluate website scripts.
    let remaining = 300;
    const visit = (value: unknown, depth = 0): void => {
      if (!value || typeof value !== "object" || depth > 8 || remaining-- <= 0) return;
      if (Array.isArray(value)) { value.slice(0, 40).forEach(item => visit(item, depth + 1)); return; }
      const node = value as Record<string, unknown>;
      const scalar = (value: unknown, nesting = 0): string => nesting > 3 ? "" : typeof value === "string" ? clean(value).slice(0, 300) :
        Array.isArray(value) ? value.slice(0, 7).map(item => scalar(item, nesting + 1)).filter(Boolean).join(", ") :
        value && typeof value === "object" && typeof (value as Record<string, unknown>).name === "string"
          ? clean((value as Record<string, string>).name).slice(0, 300) : "";
      const type = scalar(node["@type"]);
      if (/\bService\b/.test(type) && scalar(node.name)) add("services", url, `Structured service: ${scalar(node.name)}`);
      if (scalar(node.serviceType)) add("services", url, `Structured serviceType: ${scalar(node.serviceType)}`);
      if (!area && scalar(node.areaServed)) { area = true; add("area_hours", url, `Structured areaServed: ${scalar(node.areaServed)}`); }
      if (!hours && /(?:\d{1,2}:\d{2}|\b24\s*(?:\/\s*7|hours)\b)/i.test(scalar(node.openingHours))) {
        hours = true; add("area_hours", url, `Structured openingHours: ${scalar(node.openingHours)}`);
      }
      if (node.openingHoursSpecification) {
        const specs = Array.isArray(node.openingHoursSpecification) ? node.openingHoursSpecification : [node.openingHoursSpecification];
        for (const spec of specs.slice(0, 7)) {
          if (!spec || typeof spec !== "object") continue;
          if (!hours && scalar(spec.dayOfWeek) && /^\d{2}:\d{2}/.test(scalar(spec.opens)) && /^\d{2}:\d{2}/.test(scalar(spec.closes))) {
            hours = true;
            add("area_hours", url, `Structured hours: ${scalar(spec.dayOfWeek)} ${scalar(spec.opens)}-${scalar(spec.closes)}`);
          }
        }
      }
      Object.values(node).slice(0, 40).forEach(item => visit(item, depth + 1));
    };
    $("script[type='application/ld+json']").slice(0, 12).each((_, element) => {
      const json = $(element).text();
      if (json.length > 80_000) return;
      try { visit(JSON.parse(json)); } catch (error) { logSilentCatch("agent-journey:invalid-schema", error, "expected"); }
    });
    $("script, style, noscript, template, [hidden], [aria-hidden='true']").remove();
    $("[style]").each((_, element) => {
      if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(element).attr("style") || "")) $(element).remove();
    });
    // Local blocks prevent a keyword in navigation from blessing unrelated text.
    $("p, li, address, h1, h2, h3, dt, dd").slice(0, 500).each((_, element) => {
      const text = clean($(element).text());
      if (!text || text.length > 700) return;
      if (!area && /\b(?:serving|service area|areas? (?:we )?serve|available in|based in|located in)\b/i.test(text) && text.length > 18) {
        area = true; add("area_hours", url, text);
      }
      if (!hours && /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.test(text) &&
          /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:closed|24 hours)\b/i.test(text)) {
        hours = true; add("area_hours", url, text);
      }
      if (!price && /(?:[$£€]\s*\d|\b\d+(?:\.\d{2})?\s*(?:USD|dollars)\b)/i.test(text) &&
          /\b(?:price|pricing|cost|from|starting|per|fee|service|plan)\b/i.test(text)) {
        price = true; add("pricing", url, text);
      }
      if (!quote && /\b(?:request|get|ask for|contact us for)\s+(?:a\s+)?(?:free\s+)?(?:quote|estimate)\b/i.test(text)) {
        quote = true; add("pricing", url, text);
      }
    });
    $("h1,h2,h3").slice(0, 80).each((_, heading) => {
      if (!/^(?:(?:our\s+)?services(?:\s+(?:offered|provided))?|what we (?:do|offer))$/i.test(clean($(heading).text()))) return;
      const next = $(heading).next("p,ul,ol");
      if (next.length && clean(next.text()).length > 10) add("services", url, next.text());
    });
    $("[itemprop='serviceType']").slice(0, 20).each((_, element) => add("services", url, $(element).text()));
    $("a[href]").slice(0, 200).each((_, anchor) => {
      const text = clean($(anchor).text());
      if (!/\b(?:contact|book|schedule|request (?:a )?(?:quote|appointment)|inquir)/i.test(text)) return;
      const href = $(anchor).attr("href")?.trim();
      if (!href || href.startsWith("#")) return;
      const target = journeyUrl(href, url);
      if (target) {
        if (new URL(target).origin === new URL(url).origin) {
          if (!localRoute) add("contact_route", url, `Same-origin link: ${text}: ${target}`);
          localRoute = true;
        } else {
          if (!externalRoute) add("contact_route", url, `Unverified external link: ${text}: ${target}`);
          externalRoute = true;
        }
      }
    });
    const labels = new Map<string, string>();
    $("label[for]").slice(0, 200).each((_, element) => {
      const id = $(element).attr("for")!;
      const label = $(element).clone();
      label.find("input,textarea,select,button").remove();
      if (!labels.has(id)) labels.set(id, label.text());
    });
    $("form").slice(0, 15).each((_, element) => {
      const form = $(element);
      if (form.find("input[type='password']").length ||
          !/\b(?:contact|inquiry|enquiry|quote|estimate|appointment|booking|message|schedule)\b/i.test(
            `${form.attr("id") || ""} ${form.attr("aria-label") || ""} ${form.text()}`)) return;
      form.find("input[required],select[required],textarea[required]").slice(0, 50).each((_, element) => {
        const input = $(element);
        if (input.is("[type='hidden'],[type='submit'],[type='button'],[disabled]")) return;
        const id = input.attr("id");
        const wrappedLabel = input.closest("label").clone();
        wrappedLabel.find("input,textarea,select,button").remove();
        const label = clean((id && labels.get(id)) || wrappedLabel.text() || input.attr("aria-label") || "");
        if (label) add("requirements", url, `Required field shown: ${label}`);
      });
    });
    $("p,li").slice(0, 500).each((_, element) => {
      const text = clean($(element).text());
      if (text.length < 400 && /\b(?:to (?:request|book|schedule)|when (?:booking|contacting))\b/i.test(text) &&
          /\b(?:provide|include|need|bring|required)\b/i.test(text)) add("requirements", url, text);
    });
  }
  const definitions: Array<[AgentJourneyCheck["id"], string, string, string]> = [
    ["services", "Identify the services offered", "Service descriptions were found.", "Publish a clearly titled services section with specific services."],
    ["area_hours", "Establish service area and business hours", "Service area and hours were found.", "Publish both the service area and explicit opening hours."],
    ["pricing", "Distinguish published pricing from quote-only", price && quote ? "Published price signals and quote requests were both found; do not assume one price covers all work." :
      price ? "Published price signals were found; applicability and final charges are not verified." : "Quote-request wording was found; no published price was established.", "Publish applicable prices or clearly explain that a quote is required."],
    ["contact_route", "Find the inquiry or booking route", "An inquiry or booking link was found, but its destination and completion were not tested.", "Provide a clearly labeled contact, quote or booking link."],
    ["requirements", "Explain information needed next", "Explicit required fields or next-step instructions were found; completeness was not tested.", "Label required inquiry fields and explain what the customer should prepare."],
  ];
  return {
    version: 1, method: "read_only_website_evidence", pages: assessed,
    limitations: [...LIMITATIONS, ...coverage],
    checks: definitions.map(([id, label, finding, nextStep]) => {
      const observed = id === "area_hours" ? area && hours : id === "contact_route" ? localRoute : evidence[id].length > 0;
      const partial = id === "area_hours" && (area || hours);
      const externalOnly = id === "contact_route" && externalRoute && !localRoute;
      return { id, label, status: observed ? "observed" : partial || externalOnly || coverage.length > 0 ? "uncertain" : "not_found",
        finding: observed ? finding : externalOnly ? "Only an external inquiry/booking link was found; ownership, destination and completion were not verified." :
          partial ? `Only ${area ? "service area" : "hours"} evidence was found; ${area ? "hours remain" : "service area remains"} unestablished.` :
          "Not established from the captured pages. This is not proof the information is absent elsewhere.",
        evidence: evidence[id], nextStep: observed ? "Confirm accuracy with the business before relying on this information." : nextStep };
    }),
  };
}
