/**
 * Tools-layer-split S25n — agent-eval domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 persona-benchmark tools (run_agent_eval,
 * get_eval_report) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { agentEvalDomainTools } from "./handlers";

registerTools(agentEvalDomainTools);

export {
  runAgentEvalDefinition,
  getEvalReportDefinition,
  agentEvalDomainDefinitions,
} from "./definitions";

export { agentEvalDomainTools } from "./handlers";
