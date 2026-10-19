import { createHash } from "node:crypto";
import { logSilentCatch } from "./silent-catch";
import { isReviewBearingPublicText } from "./report-customer-feedback";

export type EvidenceSource = {
  id: string; title: string; url?: string; text: string;
  sha256: string; retrievedAt: string; kind: "public" | "customer" | "measurement";
};
export type ReportEvidence = {
  version: 1; capturedAt: string; sources: EvidenceSource[]; limitations: string[];
};
export type ReportSection = { heading: string; body: string };
export type CompiledBlock = { type: "fact" | "recommendation" | "assumption"; text: string; sourceIds: string[] };
export type CompiledReport = {
  sections: { heading: string; blocks: CompiledBlock[] }[];
  unknowns: string[];
};
export const hashReportBytes = (text: string): string => createHash("sha256").update(text).digest("hex");
/** Only server-computed metadata uses this wire representation. Untrusted
 * prose stays subject to the ordinary credential scanner. */
export function reportDigestForWire(hex: string): string {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error("Invalid report digest metadata");
  return `sha256-b64:${Buffer.from(hex, "hex").toString("base64url")}`;
}
export function matchesReportDigest(value: string, hex: string): boolean {
  return value === hex || value === reportDigestForWire(hex);
}
export function reportPublicUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Report URL must be HTTP(S)");
  url.username = ""; url.password = ""; url.search = ""; url.hash = "";
  return url.href;
}

/** Egress minimization is shared by intake, fetched excerpts and drafted prose.
 * The safety scanner is an additional backstop in the production connector. */
export function minimizeReportText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, value => {
      try { return reportPublicUrl(value); } catch { return "[unsafe URL omitted]"; }
    })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact omitted]")
    .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[contact omitted]")
    .replace(/\b(?:1)?[2-9]\d{2}[2-9]\d{6}\b/g, "[contact omitted]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[identifier omitted]")
    .replace(/\b(?:sk-|vc_|ghp_|github_pat_|AIza)[A-Za-z0-9_-]{8,}\b/g, "[credential omitted]")
    .replace(/\b(?:password|api[_ -]?key|secret|access[_ -]?token|payment|bank[_ -]?account)\s*[:=]\s*[^\s,;]+/gi, "[sensitive value omitted]");
}

export function businessReportContext(intake: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(["company", "website", "industry", "crm", "description", "notes"]
    .filter(key => typeof intake[key] === "string" && String(intake[key]).trim())
    .map(key => [key, minimizeReportText(String(intake[key])).slice(0, key === "description" ? 800 : 500)]));
}

export function renderReportEvidence(evidence: ReportEvidence): string {
  return JSON.stringify(evidence);
}

export function validateCompiledReport(
  input: unknown, headings: string[], evidence: ReportEvidence, customerFacing = false,
): { compiled: CompiledReport; sections: ReportSection[] } {
  const report = input as CompiledReport;
  if (!report || !Array.isArray(report.sections) || report.sections.length !== headings.length ||
      !Array.isArray(report.unknowns) || report.unknowns.length > 30 ||
      report.unknowns.some(item => typeof item !== "string" || !item.trim() || item.length > 1000)) {
    throw new Error("Invalid complete report section/unknowns contract");
  }
  const sources = new Map(evidence.sources.map(source => [source.id, source]));
  const sections = report.sections.map((section, index) => {
    if (section.heading !== headings[index] || !Array.isArray(section.blocks) ||
        section.blocks.length < 1 || section.blocks.length > 24) throw new Error("Invalid report section order or blocks");
    const body = section.blocks.map(block => {
      if (!block || !["fact", "recommendation", "assumption"].includes(block.type) ||
          typeof block.text !== "string" || block.text.trim().length < 10 || block.text.length > 3000 ||
          !Array.isArray(block.sourceIds) || block.sourceIds.length > 8 ||
          block.sourceIds.some(id => typeof id !== "string" || !sources.has(id))) {
        throw new Error("Invalid block or unknown citation");
      }
      // Inline invented IDs and external URLs cannot bypass the structured list.
      for (const match of block.text.matchAll(/\[((?:S\d+[,\s]*)+)\]/g)) {
        if ((match[1].match(/S\d+/g) || []).some(id => !block.sourceIds.includes(id))) throw new Error("Unbound inline citation");
      }
      if (block.type === "fact") {
        if (block.sourceIds.length !== 1 || !sources.get(block.sourceIds[0])!.text.includes(block.text.trim())) {
          throw new Error("Factual quotation must occur verbatim in its exact retrieved source");
        }
      }
      for (const url of block.text.match(/https?:\/\/[^\s<>"'`)]+/g) || []) {
        // A published outgoing link inside an exact quote proves link presence,
        // not that its destination/profile was fetched or independently verified.
        // Non-quotation URLs still require their own retrieved source record.
        if (block.type !== "fact" && !evidence.sources.some(source => source.url === url)) {
          throw new Error("Unretrieved citation URL");
        }
      }
      const customer = block.type === "fact" && sources.get(block.sourceIds[0])?.kind === "customer";
      const label = customerFacing ? (block.type === "fact"
        ? customer ? "Unverified supplied context" : "Source excerpt"
        : block.type === "recommendation" ? "Our recommendation" : "Planning assumption (not a forecast)") : block.type === "fact"
        ? customer ? "Customer-supplied statement (not independently verified)" : "Observed source quotation"
        : block.type === "recommendation" ? "Recommendation (not a verified outcome)" : "Assumption / illustrative estimate (validate before acting)";
      return `${label}: ${block.text.trim()}${block.sourceIds.length ? ` [${block.sourceIds.join(", ")}]` : ""}`;
    }).join("\n\n");
    if (body.length < 150) throw new Error("Compiled report section is too short");
    return { heading: section.heading, body };
  });
  return { compiled: report, sections };
}

export function reportEvidenceAppendices(evidence: ReportEvidence, unknowns: string[], review: {
  digest: string; round: number; juryVerdict: string; museRequestId: string;
  compiler?: "gemini-direct" | "muse";
}, customerFacing = false): ReportSection[] {
  return [
    { heading: "Sources & Evidence Documentation", body: evidence.sources.map(source =>
      `[${source.id}] ${source.title}\n${source.url || "Supplied context; not independently verified"}\nRetrieved: ${source.retrievedAt}\n` +
      (customerFacing ? `Excerpt: ${source.text.slice(0, 800)}${source.text.length > 800 ? " … (excerpt; full capture retained)" : ""}`
        : `Snapshot SHA-256: ${source.sha256}\n${source.text}`)
    ).join("\n\n") || "No retrievable company evidence was available." },
    { heading: "Limits, Assumptions & Validation Needed", body: [
      "Source quotations establish what the source said, not that the source is correct. Customer statements remain unverified. Recommendations and numerical scenarios are proposals, not forecasts or guaranteed profits.",
      ...evidence.limitations, ...unknowns,
    ].join("\n\n") },
    ...(customerFacing ? [{ heading: "Research Approach", body:
      "This is an independent public-source advisory opinion, not an internal company audit, financial forecast, legal opinion or AI certification. We reviewed the public sources listed above within the stated scope. Third-party and company-published statements are not independently established operational facts. Recommendations describe opportunities to test; confirm implementation dependencies and measure a small pilot before committing. No access to private systems, customer records or company financials is implied." }] : [{ heading: "Report Review Record", body: [
      `Evidence/draft binding: ${review.digest}`, `Compilation request: ${review.museRequestId}`,
      `Review rounds: ${review.round}`, `Final jury verdict: ${review.juryVerdict}`,
      (review.compiler === "gemini-direct"
        ? "Compilation used Gemini Argon through Google's direct API; served-model and usage evidence are retained."
        : "Compilation was received through the authenticated Muse/Spark report connector; external provider identity is not independently attested.") +
      " Jury triage reviewed the completed revision. Deterministic checks bound every factual quotation and citation to the retained snapshot. Model agreement is advisory, not independent factual proof. Owner approval is required before customer delivery.",
    ].join("\n") }]),
  ];
}

export async function collectBusinessReportEvidence(
  intake: Record<string, unknown>, options: { allowPaidExtraction?: boolean; retainMeasuredScore?: boolean } = {},
  dependencies?: {
    runAudit: typeof import("../audit-engine").runAudit;
    safeFetchText: typeof import("../audit-engine").safeFetchText;
    fallback: (url: string) => Promise<any>;
    publicSearch?: typeof import("./jury-public-search").juryPublicSearch;
  },
): Promise<ReportEvidence> {
  const capturedAt = new Date().toISOString();
  const evidence: ReportEvidence = { version: 1, capturedAt, sources: [], limitations: [] };
  const context = businessReportContext(intake);
  const add = (title: string, text: string, kind: EvidenceSource["kind"], url?: string, feedbackSource = false) => {
    // A company page or generic outside capture must not reintroduce excluded
    // Google-attributed review text through a different evidence path.
    if (kind === "public" && !feedbackSource && isReviewBearingPublicText(text)) {
      evidence.limitations.push("A review-bearing generic public capture was omitted; only separately bound customer-feedback samples can supply review evidence. This conservative text screen is not a licence/provenance proof for arbitrary unmarked prose.");
      return;
    }
    const minimized = minimizeReportText(text).trim();
    const snapshot = minimized.slice(0, 9000);
    if (!snapshot) return;
    if (minimized.length > snapshot.length) evidence.limitations.push(
      `A source capture was limited to its first 9,000 characters: ${url ? reportPublicUrl(url) : "supplied context"}. Uncaptured content was not assessed.`);
    evidence.sources.push({ id: `S${evidence.sources.length + 1}`, title, text: snapshot,
      kind, ...(url ? { url: reportPublicUrl(url) } : {}), sha256: hashReportBytes(snapshot), retrievedAt: capturedAt });
  };
  // Task instructions are not evidence about a prospect's business.
  const { notes: _operatorNotes, ...companyContext } = context;
  add("Supplied company identifiers/context (not independently verified)", JSON.stringify(companyContext), "customer");
  if (!context.website) {
    evidence.limitations.push("No website was supplied. This is intake-led guidance, not a verified website assessment.");
    return evidence;
  }
  const { runAudit, safeFetchText } = dependencies ?? await import("../audit-engine");
  try {
    const audit = await runAudit(context.website);
    add("Measured website technical checks", (options.retainMeasuredScore
      ? `AI readiness score: ${audit.overallScore}/100; grade: ${audit.grade}\n` : "") + audit.checks.map(check =>
      `${check.label}: ${check.status.toUpperCase()} — ${check.detail}`
    ).join("\n"), "measurement", audit.finalUrl);
    if (audit.agentJourney) {
      add("Read-only agent customer journey scope (not a live assistant or transaction test)",
        `Method: ${audit.agentJourney.method}; version ${audit.agentJourney.version}\nPages assessed: ${audit.agentJourney.pages.join(", ")}\n` +
        audit.agentJourney.limitations.join("\n"), "measurement", audit.finalUrl);
      // Separate bounded sources preserve the fifth check and coverage notes;
      // one large JSON source could lose them to the 9,000-character source cap.
      for (const check of audit.agentJourney.checks) {
        add(`Read-only agent journey: ${check.label}`,
          `${check.status}: ${check.finding}\n` +
          check.evidence.map(item => `Source: ${item.url}\nEvidence: ${item.excerpt}`).join("\n") +
          `\nNext step: ${check.nextStep}`, "measurement", audit.finalUrl);
      }
    }
  } catch {
    evidence.limitations.push("Technical website checks could not be completed; do not infer that missing measurements indicate failures.");
  }
  const { collectPublicReportSupplement } = await import("./report-public-research");
  const supplement = await collectPublicReportSupplement(context.website, context.company || "",
    dependencies ? {
      fetchText: url => dependencies.safeFetchText(url, { timeoutMs: 7000, maxBytes: 100_000, maxRedirects: 2 }),
      search: dependencies.publicSearch || (async () => ({ success: false, results: [] })),
    } : undefined);
  for (const source of supplement.sources) add(source.title, source.text, source.kind, source.url);
  evidence.limitations.push(...supplement.limitations);
  // SSRF-pinned bounded fetch, including redirects. No arbitrary links or external browsing tools.
  const home = await safeFetchText(context.website, { timeoutMs: 10_000, maxBytes: 180_000, maxRedirects: 3 });
  const { collectReportCustomerFeedback } = await import("./report-customer-feedback");
  const feedback = await collectReportCustomerFeedback(context.website, context.company || "", home.ok ? home.text : "",
    dependencies ? {
      fetchText: url => dependencies.safeFetchText(url, { timeoutMs: 7000, maxBytes: 100_000, maxRedirects: 2 }),
      search: dependencies.publicSearch || (async () => ({ success: false, results: [] })),
    } : undefined);
  for (const source of feedback.sources) add(source.title, source.text, source.kind, source.url, true);
  evidence.limitations.push(...feedback.limitations);
  if (!home.ok) {
    if (options.allowPaidExtraction === false) {
      evidence.limitations.push("Direct website retrieval failed; paid extraction is disabled for this free-research run. Public company claims remain unverified.");
      return evidence;
    }
    // Preserve the established executive-report extraction ladder on a bot
    // block. The fallback contributes content only, never technical results.
    try {
      const webFetch = dependencies?.fallback ?? (await import("../tools/domains/web/handlers")).webFetch;
      const fetched: any = await webFetch(context.website);
      if (fetched?.success && typeof fetched.content === "string" && fetched.content.trim().length >= 300) {
        add("Company website content retrieved through the fallback extraction ladder", fetched.content, "public", context.website);
        evidence.limitations.push("The direct homepage fetch failed. Fallback extracted content is retained; extra company pages and technical properties not independently measured remain unknown.");
        return evidence;
      }
    } catch { logSilentCatch("business-report-evidence:fallback", "Public retrieval fallback failed"); }
    evidence.limitations.push("Website content retrieval and fallback failed; company-specific public claims cannot be verified.");
    return evidence;
  }
  const { load } = await import("cheerio");
  const extract = (html: string) => {
    const $ = load(html);
    $("script,style,nav,footer,header,noscript,form").remove();
    const title = $("title").text().trim();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    if (/"reviewBody"\s*:|"aggregateRating"\s*:/i.test(html)) {
      evidence.limitations.push("A company page containing structured review content was omitted from generic company prose; it was not used as independent customer feedback.");
      return { title, text: "" };
    }
    return { title, text };
  };
  const page = extract(home.text);
  add(page.title || "Company homepage", page.text, "public", home.finalUrl);
  const base = new URL(home.finalUrl);
  const $ = load(home.text);
  const links = new Set<string>();
  $("a[href]").each((_index, node) => {
    if (links.size >= 3) return;
    try {
      const url = new URL($(node).attr("href")!, base);
      if (url.origin === base.origin && /about|services|products|solutions/i.test(url.pathname) &&
          !url.username && !url.password && !url.search) {
        url.hash = "";
        if (url.href !== base.href) links.add(url.href);
      }
    } catch (error) { logSilentCatch("business-report-evidence:invalid-link", error, "expected"); }
  });
  for (const url of links) {
    const fetched = await safeFetchText(url, { timeoutMs: 8_000, maxBytes: 120_000, maxRedirects: 2 });
    if (fetched.ok && new URL(fetched.finalUrl).origin === base.origin) {
      const content = extract(fetched.text);
      add(content.title || "Company information page", content.text, "public", fetched.finalUrl);
    } else evidence.limitations.push(`A company-information page was not retrieved: ${url}`);
  }
  evidence.limitations.push("Scope: supplied identifiers/context, live technical checks where available, actual llms.txt where retrievable, homepage, up to three company/service/product pages, up to two outside public pages and a separate bounded customer-feedback search (up to three candidate page reads). Only explicitly retrieved review excerpts are customer feedback. Competitor, legal, vendor pricing and market completeness are not established.");
  return evidence;
}
