import { reportPublicUrl, type EvidenceSource } from "./business-report-evidence";
import { logSilentCatch } from "./silent-catch";
import { isRestrictedFeedbackHost, isReviewBearingPublicText } from "./report-customer-feedback";

type PublicSource = Pick<EvidenceSource, "title" | "url" | "text" | "kind">;
type ResearchDependencies = {
  search: (query: string) => Promise<{ success: boolean; results: { url: string }[] }>;
  fetchText: (url: string) => Promise<{ ok: boolean; text?: string; finalUrl?: string }>;
};

/** Search is discovery only. Only bounded, SSRF-pinned fetched text is evidence.
 * No model/API charges, no extraction fallbacks and no credential-bearing input. */
export async function collectPublicReportSupplement(
  website: string, company: string, dependencies?: ResearchDependencies,
): Promise<{ sources: PublicSource[]; limitations: string[] }> {
  const sources: PublicSource[] = [];
  const limitations: string[] = [];
  const base = new URL(reportPublicUrl(website));
  const fetchText = dependencies?.fetchText ?? (async (url: string) => {
    const { safeFetchText } = await import("../audit-engine");
    return safeFetchText(url, { timeoutMs: 7000, maxBytes: 100_000, maxRedirects: 2 });
  });
  const search = dependencies?.search ?? (async (query: string) => {
    const { juryPublicSearch } = await import("./jury-public-search");
    return juryPublicSearch(query);
  });
  try {
    const url = new URL("/llms.txt", base).href;
    const result = await fetchText(url);
    // A redirect/login/HTML soft-404 is not an observed llms.txt body.
    if (result.ok && typeof result.text === "string" && typeof result.finalUrl === "string" &&
        new URL(result.finalUrl).origin === base.origin &&
        new URL(result.finalUrl).pathname === "/llms.txt" && result.text.trim().length > 15 &&
        !/<(?:!doctype|html|body|form)\b/i.test(result.text)) {
      sources.push({ title: "Retrieved llms.txt contents (supplementary guidance, not certification)",
        url: reportPublicUrl(result.finalUrl), text: result.text, kind: "public" });
    } else limitations.push("The actual llms.txt contents were not retrieved as readable text; do not infer a pass/failure from this.");
  } catch {
    limitations.push("The llms.txt content retrieval failed; its contents remain unknown.");
  }
  const name = company.replace(/[^a-zA-Z0-9 &'.,-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
  if (name.length < 4) {
    limitations.push("Outside company research needs a sufficiently specific public company name.");
    return { sources, limitations };
  }
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const candidates = new Set<string>();
  // At most two searches and two external fetch attempts, including failures.
  for (const suffix of ["company products services", "company news industry profile"]) {
    if (candidates.size >= 2) break;
    try {
      const found = await search(`"${name}" ${suffix}`);
      if (!found.success) {
        limitations.push("A free outside-company search was unavailable or returned no usable results; outside coverage is incomplete.");
        continue;
      }
      for (const row of found.results.slice(0, 4)) {
        try {
          const url = new URL(row.url);
          if (url.username || url.password || !["http:", "https:"].includes(url.protocol) ||
              isRestrictedFeedbackHost(url.hostname) ||
              url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) continue;
          candidates.add(reportPublicUrl(url.href));
          if (candidates.size >= 2) break;
        } catch (error) { logSilentCatch("report-public-research:discovery-url", error, "expected"); }
      }
    } catch {
      limitations.push("A free outside-company search failed; no paid search fallback was used.");
    }
  }
  for (const url of candidates) {
    try {
      const result = await fetchText(url);
      if (!result.ok || typeof result.text !== "string" || typeof result.finalUrl !== "string") {
        limitations.push("An outside search result could not be retrieved."); continue;
      }
      const finalUrl = new URL(result.finalUrl);
      if (isRestrictedFeedbackHost(finalUrl.hostname)) {
        limitations.push("An outside result redirected to a restricted review/social source; it was not retained.");
        continue;
      }
      if (finalUrl.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) continue;
      const { load } = await import("cheerio");
      const $ = load(result.text);
      const title = $("title").text().trim();
      if (/"@type"\s*:\s*(?:"(?:Review|AggregateRating)"|\[[^\]]*"(?:Review|AggregateRating)")|"(?:reviewBody|aggregateRating)"\s*:/i.test(result.text) ||
          /review|testimonial|complaint/i.test(finalUrl.pathname)) {
        limitations.push("An outside review/listing page was reserved for the bounded customer-feedback collector; generic page text was not retained.");
        continue;
      }
      $("script,style,nav,header,footer,form,noscript").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();
      if (isReviewBearingPublicText(text)) {
        limitations.push("A review-bearing outside capture was omitted from generic research and reserved for the customer-feedback collector.");
        continue;
      }
      if (text.length < 100 || !normalize(text).includes(normalize(name))) {
        limitations.push("An outside result did not contain enough matching company evidence; it was excluded.");
        continue;
      }
      sources.push({ title: `Outside public source: ${title || name}`, url: reportPublicUrl(finalUrl.href), text, kind: "public" });
    } catch {
      limitations.push("An outside result failed safe retrieval and was not used.");
    }
  }
  limitations.push("Outside research is a bounded public sample, not exhaustive due diligence. Search snippets are discovery only. Matching names and third-party claims require corroboration; no private operational or financial access is implied.");
  return { sources, limitations };
}
