/**
 * Tools-layer-split S19 — multiagent domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time.
 */
import { registerTools } from "../../registry";
import { multiagentDomainTools } from "./handlers";

registerTools(multiagentDomainTools);

export {
  ensembleQueryDefinition,
  juryTriageDefinition,
  secondOpinionDefinition,
  multiagentDomainDefinitions,
} from "./definitions";

export { multiagentDomainTools } from "./handlers";
