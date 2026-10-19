import { load } from "cheerio";
import { logSilentCatch } from "./silent-catch";
import { reportPublicUrl, type EvidenceSource } from "./business-report-evidence";

type Source = Pick<EvidenceSource, "title" | "url" | "text" | "kind">;
export type FeedbackDependencies = {
  search: (query: string) => Promise<{ success: boolean; results: { url: string }[] }>;
  fetchText: (url: string) => Promise<{ ok: boolean; text?: string; finalUrl?: string }>;
};
const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isSocial = (name: string) => /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)$/.test(name);
const isGoogle = (name: string) => /(^|\.)(google\.[a-z.]+|goo\.gl|g\.page|googleusercontent\.com)$/.test(name);
const clean = (value: string) => load(`<body>${value}</body>`)("body").text().replace(/\s+/g, " ").trim();
/** Shared by generic research so it cannot bypass the feedback collector. */
export const isRestrictedFeedbackHost = (name: string): boolean => isGoogle(name.toLowerCase()) || isSocial(name.toLowerCase());
/** Conservative exclusion, not proof of the origin/licence of arbitrary prose.
 * Review-bearing generic captures must use the separately bound sample path. */
export const isReviewBearingPublicText = (text: string): boolean =>
  /\b(?:google|reviews?|ratings?|testimonials?|feedback)\b|"reviewBody"\s*:|"aggregateRating"\s*:/i.test(text);
const websiteMatches = (value: string, base: URL): boolean => {
  try {
    const candidate = new URL(value);
    return ["http:", "https:"].includes(candidate.protocol) && !candidate.username && !candidate.password &&
      !candidate.search && host(candidate) === host(base) &&
      candidate.pathname.replace(/\/+$/, "") === base.pathname.replace(/\/+$/, "");
  } catch { return false; }
};

/** Discovery is not evidence. No credentials, paid fallbacks, posting or models.
 * Opinion samples are deliberately small; they cannot establish satisfaction. */
export async function collectReportCustomerFeedback(
  website: string, company: string, homepageHtml: string, dependencies?: FeedbackDependencies,
): Promise<{ sources: Source[]; limitations: string[] }> {
  const sources: Source[] = [];
  const limitations: string[] = [
    "Customer-feedback coverage: Google review content was not collected; a permitted retention/export route has not been established.",
    "Facebook and X customer reviews/mentions were not retrieved through an authorized connector. Company social links/posts are not independent customer feedback.",
    "Any retrieved reviews are attributed, unverified opinions. The small sample is not representative, not a satisfaction score or proof of operational failures. No sentiment, ratings or complaints may be inferred from unavailable feedback.",
    "Network captures are byte-capped and may be partial even when structured data parses. Only the captured sample was assessed; no complete review history or source-licensing attestation is implied.",
  ];
  const base = new URL(reportPublicUrl(website));
  const name = company.replace(/[^a-zA-Z0-9 &'.,-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
  const $home = load(homepageHtml.slice(0, 180_000));
  const social = new Set<string>();
  $home("a[href]").each((_index, node) => {
    try {
      const url = new URL($home(node).attr("href")!, base);
      if (social.size < 6 && isSocial(host(url)) && ["http:", "https:"].includes(url.protocol) &&
          !url.username && !url.password && !url.search) social.add(reportPublicUrl(url.href));
    } catch (error) { logSilentCatch("report-customer-feedback:page-url", error, "expected"); }
  });
  if (social.size) sources.push({ title: "Company-published social profile links (not customer reviews)",
    url: base.href, kind: "public", text: [
      "Source type: company-published social links observed in the retrieved company homepage.",
      ...Array.from(social), "These links do not establish profile ownership, posting activity, customer sentiment, review counts or engagement.",
    ].join("\n") });
  if (name.length < 4) {
    limitations.push("Customer-feedback discovery was not attempted: the public company name was insufficiently specific.");
    return { sources, limitations };
  }
  const fetchText = dependencies?.fetchText ?? (async (url: string) => {
    const { safeFetchText } = await import("../audit-engine");
    return safeFetchText(url, { timeoutMs: 7000, maxBytes: 100_000, maxRedirects: 2 });
  });
  const search = dependencies?.search ?? (async (query: string) => {
    const { juryPublicSearch } = await import("./jury-public-search");
    return juryPublicSearch(query);
  });
  const candidates = new Set<string>();
  for (const suffix of ["customer reviews", "customer complaints industry directory"]) {
    try {
      const found = await search(`"${name}" "${host(base)}" ${suffix}`);
      if (!found.success || !found.results.length) {
        limitations.push("A free customer-feedback search was unavailable or found no usable results; coverage is incomplete.");
        continue;
      }
      for (const row of found.results.slice(0, 4)) {
        try {
          const url = new URL(row.url);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
              isGoogle(host(url)) || isSocial(host(url)) || host(url) === host(base)) continue;
          if (candidates.size < 3) candidates.add(reportPublicUrl(url.href));
        } catch (error) { logSilentCatch("report-customer-feedback:search-url", error, "expected"); }
      }
    } catch {
      limitations.push("A free customer-feedback search failed; no paid fallback was used.");
    }
  }
  let sampleCount = 0;
  const seenFinal = new Set<string>();
  for (const url of candidates) {
    try {
      const result = await fetchText(url);
      if (!result.ok || typeof result.text !== "string" || !result.finalUrl) {
        limitations.push(`A customer-feedback candidate could not be retrieved: ${url}`); continue;
      }
      const final = new URL(result.finalUrl);
      if (isGoogle(host(final)) || isSocial(host(final)) || host(final) === host(base) ||
          !["http:", "https:"].includes(final.protocol) || final.username || final.password) {
        limitations.push("A feedback candidate redirected to an excluded source; no content was retained."); continue;
      }
      const canonical = reportPublicUrl(final.href);
      if (seenFinal.has(canonical)) continue;
      seenFinal.add(canonical);
      if (result.text.length > 100_000) {
        limitations.push(`A feedback candidate exceeded the structured-data capture bound; no sample or listing classification was retained: ${canonical}`);
        continue;
      }
      const $ = load(result.text);
      const schemas: unknown[] = [];
      let invalidSchema = false;
      const scripts = $('script[type="application/ld+json"]');
      scripts.slice(0, 12).each((_i, node) => {
        try { schemas.push(JSON.parse($(node).text())); } catch { invalidSchema = true; }
      });
      if (invalidSchema || scripts.length > 12) {
        limitations.push(`A feedback candidate had unparseable or over-limit structured review data; no sample or listing classification was retained: ${canonical}`);
        continue;
      }
      const linksCompany = $("a[href]").toArray().some(node => {
        try {
          const link = new URL($(node).attr("href")!, final);
          return websiteMatches(link.href, base);
        } catch { return false; }
      });
      $("script,style,nav,header,footer,form,noscript").remove();
      const body = $("body").text().replace(/\s+/g, " ").trim();
      if (!linksCompany || !normalize(body).includes(normalize(name)) ||
          /verify you are human|captcha|access denied|log in to continue/i.test(body)) {
        limitations.push(`A feedback candidate could not be matched to the exact company website and name, or was access-blocked: ${canonical}`); continue;
      }
      const samples: string[] = [];
      const seenSamples = new Set<string>();
      let remaining = 300, visited = 0;
      const queue = [...schemas];
      // Only reviews nested under this business, never unrelated site reviews.
      while (queue.length && visited++ < 120) {
        const value = queue.shift() as any;
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value)) { queue.push(...value.slice(0, 30)); continue; }
        if (Array.isArray(value["@graph"])) queue.push(...value["@graph"].slice(0, 30));
        const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
        if (!types.some((type: unknown) => ["LocalBusiness", "Organization", "Corporation", "Store", "Review"].includes(String(type)))) continue;
        const business = types.includes("Review") ? value.itemReviewed : value;
        if (!business || typeof business.name !== "string" || normalize(business.name) !== normalize(name)) continue;
        if (typeof business.url !== "string" || !websiteMatches(business.url, base)) continue;
        const reviews = types.includes("Review") ? [value] : Array.isArray(value.review) ? value.review : [value.review];
        for (const item of reviews.slice(0, 10)) {
          if (samples.length >= 3 || remaining < 30 || typeof item?.reviewBody !== "string") continue;
          // Do not ingest Google-syndicated reviews through another website.
          if (/google|goo\.gl|g\.page/i.test(JSON.stringify(item))) {
            limitations.push("A Google-attributed review was excluded pending a permitted data route."); continue;
          }
          const bodyText = clean(item.reviewBody);
          const key = normalize(bodyText);
          if (seenSamples.has(key)) continue;
          const text = bodyText.slice(0, Math.min(180, remaining));
          if (text.length < 20) continue;
          seenSamples.add(key);
          remaining -= text.length;
          const date = typeof item.datePublished === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(item.datePublished) &&
            Number.isFinite(Date.parse(item.datePublished)) ? item.datePublished.slice(0, 10) : "not supplied";
          samples.push(`Published: ${date}. Customer review (not independently verified): ${text}`);
        }
      }
      if (queue.length) limitations.push(`The bounded structured review scan was incomplete: ${canonical}. No exhaustive review-count claim is supported.`);
      sampleCount += samples.length;
      sources.push({ title: samples.length ? "Matched public customer-review sample" : "Matched public page identity (no usable review sample)",
        url: canonical, kind: "public", text: [
          `Source type: ${samples.length ? "third-party customer reviews" : "third-party page identity, not customer reviews"}.`,
          "Identity basis: retrieved page names the company and links the supplied website hostname/path; company location/reviewer purchase status were not independently verified.",
          `Sample: ${samples.length} review excerpts; maximum 300 quoted characters per page. Not a complete or representative review history.`,
          ...(samples.length ? samples : ["Only business-name/website-link matching was observed. No page prose is retained as a substitute for a bound review sample."]),
        ].join("\n") });
    } catch {
      limitations.push(`A customer-feedback candidate failed safe retrieval or parsing and was excluded: ${url}`);
    }
  }
  limitations.push(`Retrieved customer-feedback sample: ${sampleCount} review excerpts. ${sampleCount ? "Themes are advisory and need corroboration." : "Customer satisfaction, strengths and complaints remain unassessed; absence of a usable sample is not evidence of good or bad service."}`);
  return { sources, limitations };
}
