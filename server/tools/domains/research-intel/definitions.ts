/**
 * Tools-layer-split S25k — research-intel domain tool definitions.
 *
 * Selection: the 9 tools that remained in the SHARED case-fallthrough block that
 * dispatched (via one `fnMap`) to `./agentic-features` after S16 split the 8
 * outreach labels off the tail — research (`save_evidence`, `query_evidence`,
 * `synthesize_research`), competitor intel (`add_competitor`, `list_competitors`,
 * `take_competitor_snapshot`, `detect_competitor_changes`, `competitor_briefing`)
 * and `define_icp`. All 9 fns take `{ tenantId, ...realParams }` and read NO
 * `_`-prefixed trust signal (verified in `server/agentic-features.ts`), so the
 * only migration seam is `_tenantId`→`ctx.tenantId`.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const saveEvidenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "save_evidence",
    description: "Save a research finding as structured evidence with source citation, confidence score, and theme. Evidence is stored separately from final answers and can be re-synthesized later. Use this after web_search or deep_research to build a trustworthy evidence store.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The research question this evidence relates to" },
        claim: { type: "string", description: "The factual claim or finding" },
        sourceUrl: { type: "string", description: "URL where this was found" },
        sourceTitle: { type: "string", description: "Title of the source document/page" },
        sourceDate: { type: "string", description: "Date of the source (YYYY-MM-DD or descriptive)" },
        theme: { type: "string", description: "Category/theme (e.g. 'pricing', 'market_size', 'competitors', 'regulation')" },
        confidence: { type: "number", description: "Confidence score 0-100 (100 = verified fact, 50 = unconfirmed, below 30 = speculation)" },
        supportingQuote: { type: "string", description: "Direct quote from source supporting the claim" },
        contradicts: { type: "string", description: "Note if this contradicts other evidence" },
        projectId: { type: "number", description: "Optional project ID to associate with" },
      },
      required: ["query", "claim"],
    },
  },
};

export const queryEvidenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "query_evidence",
    description: "Search the evidence store for previously saved research findings. Filter by query, theme, or minimum confidence. Returns claims with their citations and confidence scores.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text to match against claims and queries" },
        theme: { type: "string", description: "Filter by theme/category" },
        minConfidence: { type: "number", description: "Minimum confidence score (0-100)" },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
      required: [],
    },
  },
};

export const synthesizeResearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "synthesize_research",
    description: "Synthesize all evidence for a query into a structured research memo or report. Every claim is cited, contradictions are flagged, and open questions are listed. Use after saving multiple evidence items via save_evidence.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The research question to synthesize evidence for" },
        format: { type: "string", enum: ["memo", "report", "briefing", "bullet_points"], description: "Output format (default: memo)" },
      },
      required: ["query"],
    },
  },
};

export const addCompetitorDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "add_competitor",
    description: "Add a competitor to the watchlist for ongoing monitoring. Provide their website and optionally their pricing, product, and changelog URLs for targeted tracking.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Competitor company name" },
        website: { type: "string", description: "Main website URL" },
        pricingUrl: { type: "string", description: "Pricing page URL (for price change detection)" },
        productUrl: { type: "string", description: "Product/features page URL" },
        changelogUrl: { type: "string", description: "Changelog or what's new page URL" },
        notes: { type: "string", description: "Notes about this competitor" },
      },
      required: ["name", "website"],
    },
  },
};

export const listCompetitorsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_competitors",
    description: "Use BEFORE producing competitive analysis, pricing decisions, or positioning copy — also when Bob asks \"what changed at <competitor>\" the watchlist will show snapshot deltas. Returns each tracked competitor with snapshot count and recent change count. Pair with the competitor-snapshot tools to read the actual diffs.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const takeCompetitorSnapshotDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "take_competitor_snapshot",
    description: "Crawl a competitor's tracked pages (website, pricing, product, changelog) and save a snapshot. Used as a baseline or for periodic monitoring. Snapshots are compared to detect changes.",
    parameters: {
      type: "object",
      properties: {
        competitorId: { type: "number", description: "Competitor ID from the registry" },
      },
      required: ["competitorId"],
    },
  },
};

export const detectCompetitorChangesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "detect_competitor_changes",
    description: "Compare the latest snapshot of competitor pages against previous snapshots. Uses AI to identify meaningful changes in pricing, features, messaging, and positioning. Ignores cosmetic changes.",
    parameters: {
      type: "object",
      properties: {
        competitorId: { type: "number", description: "Specific competitor ID (optional — omit to check all)" },
      },
      required: [],
    },
  },
};

export const competitorBriefingDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "competitor_briefing",
    description: "Generate an executive intelligence briefing summarizing all competitor changes over a period. Groups by competitor, highlights high-significance changes, and provides strategic recommendations.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", description: "Time period to cover (e.g. '7 days', '30 days', '1 month'). Default: 7 days" },
      },
      required: [],
    },
  },
};

export const defineIcpDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "define_icp",
    description: "Define an Ideal Customer Profile (ICP) with scoring criteria. Used by score_leads to automatically qualify leads. Describe your target customer characteristics and scoring weights.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for this ICP rule (e.g. 'Enterprise SaaS buyers')" },
        icpDescription: { type: "string", description: "Description of the ideal customer profile" },
        criteria: { type: "string", description: "Scoring criteria (e.g. 'Industry: +20 if SaaS/tech. Size: +30 if >50 employees. Role: +25 if C-level/VP. Budget: +25 if >$50k ARR')" },
      },
      required: ["name", "icpDescription", "criteria"],
    },
  },
};

export const researchIntelDomainDefinitions: ToolDefinition[] = [
  saveEvidenceDefinition,
  queryEvidenceDefinition,
  synthesizeResearchDefinition,
  addCompetitorDefinition,
  listCompetitorsDefinition,
  takeCompetitorSnapshotDefinition,
  detectCompetitorChangesDefinition,
  competitorBriefingDefinition,
  defineIcpDefinition,
];
