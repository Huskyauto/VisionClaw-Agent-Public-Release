/**
 * Tools-layer-split S26b — ab-optimizer domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 tools (create_ab_experiment / record_ab_event)
 * migrate their definitions AND handlers. Backed by server/ab-optimizer.
 */
import { registerTools } from "../../registry";
import { abOptimizerDomainTools } from "./handlers";

registerTools(abOptimizerDomainTools);

export {
  createAbExperimentDefinition,
  recordAbEventDefinition,
  abOptimizerDomainDefinitions,
} from "./definitions";

export { abOptimizerDomainTools } from "./handlers";
