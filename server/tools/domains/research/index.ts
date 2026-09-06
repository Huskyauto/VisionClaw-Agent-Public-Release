/**
 * Tools-layer-split — research domain barrel. Re-exports definitions for the
 * legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time.
 */
import { registerTools } from "../../registry";
import { researchDomainTools } from "./handlers";

registerTools(researchDomainTools);

export {
  deepResearchDefinition,
  parallelResearchDefinition,
  researchDigestDefinition,
  recursiveSynthesizeDefinition,
  trendResearchDefinition,
  findingsPublishDefinition,
  findingsReadDefinition,
  ingestPaperDefinition,
  researchDomainDefinitions,
} from "./definitions";

export { researchDomainTools } from "./handlers";
