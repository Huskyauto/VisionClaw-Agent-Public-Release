/**
 * Tools-layer-split S26f — seo domain barrel. Re-exports the definitions for the
 * legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers at
 * import time. The 3 tools (aeo_score, seo_content_audit, generate_schema_markup)
 * migrate their definitions AND handlers. aeo_score is backed by
 * server/lib/aeo-score; the other two are fully inline (no backing lib).
 */
import { registerTools } from "../../registry";
import { seoDomainTools } from "./handlers";

registerTools(seoDomainTools);

export {
  aeoScoreDefinition,
  seoContentAuditDefinition,
  generateSchemaMarkupDefinition,
  seoDomainDefinitions,
} from "./definitions";

export { seoDomainTools } from "./handlers";
