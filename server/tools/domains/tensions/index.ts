/**
 * Tools-layer-split S25j — tensions domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 6 DreamGraph "Tensions + ADRs" tools
 * (create_tension, list_open_tensions, resolve_tension, create_adr, list_adrs,
 * supersede_adr) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { tensionsDomainTools } from "./handlers";

registerTools(tensionsDomainTools);

export {
  createTensionDefinition,
  listOpenTensionsDefinition,
  resolveTensionDefinition,
  createAdrDefinition,
  listAdrsDefinition,
  supersedeAdrDefinition,
  tensionsDomainDefinitions,
} from "./definitions";

export { tensionsDomainTools } from "./handlers";
