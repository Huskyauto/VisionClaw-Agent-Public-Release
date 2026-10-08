/**
 * Tools-layer-split S25t — crews domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time. The 2 crews tools (create_crew, create_flow) migrate their
 * definitions AND handlers. Both are ADMIN-ONLY, backed by server/crews-engine.
 */
import { registerTools } from "../../registry";
import { crewsDomainTools } from "./handlers";

registerTools(crewsDomainTools);

export {
  createCrewDefinition,
  createFlowDefinition,
  crewsDomainDefinitions,
} from "./definitions";

export { crewsDomainTools } from "./handlers";
