/**
 * Tools-layer-split structured-extraction domain barrel. Re-exports the
 * definition for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handler at import time. Tool (S28): template_scrape — a thin wrapper
 * over server/structured-extraction.ts. SEAM: read-from-ctx (ctx.tenantId →
 * the backing lib's `_tenantId` recipe-cache scope).
 */
import { registerTools } from "../../registry";
import { structuredExtractionDomainTools } from "./handlers";

registerTools(structuredExtractionDomainTools);

export {
  templateScrapeDefinition,
  structuredExtractionDomainDefinitions,
} from "./definitions";

export { structuredExtractionDomainTools } from "./handlers";
