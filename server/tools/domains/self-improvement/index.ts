/**
 * Tools-layer-split S26b — self-improvement domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 3 tools (log_experiment /
 * get_experiments / run_self_improvement) migrate their definitions AND handlers.
 * Backed by server/self-improvement.
 */
import { registerTools } from "../../registry";
import { selfImprovementDomainTools } from "./handlers";

registerTools(selfImprovementDomainTools);

export {
  logExperimentDefinition,
  getExperimentsDefinition,
  runSelfImprovementDefinition,
  selfImprovementDomainDefinitions,
} from "./definitions";

export { selfImprovementDomainTools } from "./handlers";
