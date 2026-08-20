/**
 * Tools-layer-split S28 — structured-extraction-domain tool definition.
 *
 * `template_scrape` — a single thin wrapper over server/structured-extraction.ts.
 * Definition is a VERBATIM lift of the inline object literal previously in
 * server/tools.ts's TOOL_DEFINITIONS array — same name/description/parameters
 * (the LLM-facing contract is byte-identical); only its storage location
 * changes. The facade re-imports this const ref and splices it back at its
 * original array position.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const templateScrapeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "template_scrape",
    description: "Extract typed structured data from a webpage using a Zod-style schema. First call uses an LLM to generate a deterministic CSS-selector recipe; subsequent calls of the same (domain + schema) re-use the cached recipe at ZERO LLM cost. After 3 successful cache hits the recipe is GRADUATED. Snaps back to LLM regeneration if coverage drops below 50%. Use for repeat-scrape patterns: lead enrichment fields from company About pages, competitor pricing, product listings, structured directory data.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to scrape" },
        schema: { type: "object", description: "JSON object describing desired fields. Example: {company:'string', employees:'number', tagline:'string', team:[{name:'string', title:'string'}]}" },
        schemaName: { type: "string", description: "Friendly name for this schema (e.g. 'company_about', 'product_listing'). Used to key the recipe cache." },
        forceRegenerate: { type: "boolean", description: "Force LLM regeneration of the recipe even if cached. Default false." },
      },
      required: ["url", "schema"],
    },
  },
};

export const structuredExtractionDomainDefinitions: ToolDefinition[] = [
  templateScrapeDefinition,
];
