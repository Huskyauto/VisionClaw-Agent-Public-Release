/**
 * Tools-layer-split S25r — monid-domain tool definitions.
 *
 * The 4 contiguous Monid tools (`monid_discover`, `monid_inspect`, `monid_run`,
 * `monid_catalog_browse`) — the catalog-discovery + paid-endpoint-execution
 * cluster. `discover`/`inspect`/`run` are backed by `server/lib/monid`;
 * `catalog_browse` is a FREE local snapshot read (data/monid/catalog-curated.json).
 * All four fence their upstream output through `external-content-security`
 * (`wrapExternalContent`) — one coherent domain.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (names, descriptions, parameter
 * schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const monidDiscoverDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "monid_discover",
    description: "DISCOVER-FIRST: Search Monid's catalog of hundreds of agentic web/data endpoints (scrapers, enrichment, social media, search, product/company/people data, content monitoring) BEFORE writing a custom scraper or telling the user 'I can't access that'. Many tasks already have a faster, paid-per-use endpoint. Returns a ranked list of endpoints with `id` (use with monid_inspect / monid_run), name, description, and pricing. Run this any time the request involves fetching, scraping, enriching, or interacting with an external service.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you need — e.g. 'twitter posts by handle', 'company employee count', 'amazon product reviews'" },
        limit: { type: "number", description: "Max results (1–50, default 10)" },
        minScore: { type: "number", description: "Minimum relevance score 0..1 (optional)" },
      },
      required: ["query"],
    },
  },
};

export const monidInspectDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "monid_inspect",
    description: "Read a Monid endpoint's input schema (pathParams / queryParams / body / bodyType), pricing, and docs BEFORE calling monid_run. ALWAYS inspect before running — never guess at parameter shape. The `input` field returned here is the source of truth; its three sub-keys map 1:1 onto monid_run's `path` / `query` / `body` parameters. If `input.queryParams.required = ['query']` you MUST pass `query: { query: '...' }` to monid_run, not `body`.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Endpoint id from monid_discover result" },
      },
      required: ["id"],
    },
  },
};

export const monidRunDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "monid_run",
    description: "Execute a Monid endpoint with structured input. Endpoints are PAID per call ($0.001–$0.05 typical) — ONLY call after monid_inspect confirms the right endpoint AND tells you the exact param shape. Mapping is 1:1: inspect's `input.body` → `body`, `input.queryParams` → `query`, `input.pathParams` → `path`. WORKED EXAMPLE: inspect for `api.strale.io/x402/google-search` returns `{input:{queryParams:{required:['query'],properties:{query,num_results,country,language}}}, price:{amount:0.011}}`. Therefore call: `monid_run({ id:'api.strale.io/x402/google-search', query:{ query:'wellness-program plateau 2026', num_results:10 }, wait:true })`. The `query` key here is the param-bag name (NOT the search string) — the search string is the `query` field INSIDE that bag because that's what the schema named it. Use `wait:true` for jobs <60s; for longer, omit and poll the returned `runId`.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Endpoint id from monid_discover/inspect" },
        body: { type: "object", description: "Request body (matches monid_inspect input.body shape)", additionalProperties: true },
        query: { type: "object", description: "Query params (matches input.queryParams)", additionalProperties: true },
        path: { type: "object", description: "Path params (matches input.pathParams)", additionalProperties: true },
        wait: { type: "boolean", description: "Block until completion (default false → returns runId for polling)" },
        timeoutMs: { type: "number", description: "Per-call timeout 5000–180000 (default 60000)" },
      },
      required: ["id"],
    },
  },
};

export const monidCatalogBrowseDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "monid_catalog_browse",
    description: "FREE local browse of the curated VCA-fit Monid endpoint snapshot (no API call, no spend). Returns category-organized endpoint slugs with descriptions, prices, and SQS quality scores. USE THIS FIRST to recognize 'is the kind of endpoint I need likely available?' before paying for monid_discover. Categories: social_media, commerce_reviews, web_research, finance_market, lead_enrichment, media_ai, document_pdf, comms_outreach, utilities. Snapshot regenerates weekly — for the long-tail or freshest catalog, fall through to monid_discover. Pass `category` to filter, omit to get all categories.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["social_media","commerce_reviews","web_research","finance_market","lead_enrichment","media_ai","document_pdf","comms_outreach","utilities"], description: "Filter to a single category. Omit to see all categories with use-cases." },
        search: { type: "string", description: "Optional substring filter on slug+description (case-insensitive)" },
      },
      required: [],
    },
  },
};

/** All monid-domain definitions, in facade splice order. */
export const monidDomainDefinitions: ToolDefinition[] = [
  monidDiscoverDefinition,
  monidInspectDefinition,
  monidRunDefinition,
  monidCatalogBrowseDefinition,
];
