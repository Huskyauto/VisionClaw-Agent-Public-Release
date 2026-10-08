/**
 * Tools-layer-split S26f — content-ops domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 tools (lookup_output_skill, repurpose_content)
 * migrate their definitions AND handlers. Backed by server/lib/output-skills and
 * server/lib/content-repurposer respectively.
 */
import { registerTools } from "../../registry";
import { contentOpsDomainTools } from "./handlers";

registerTools(contentOpsDomainTools);

export {
  lookupOutputSkillDefinition,
  repurposeContentDefinition,
  contentOpsDomainDefinitions,
} from "./definitions";

export { contentOpsDomainTools } from "./handlers";
