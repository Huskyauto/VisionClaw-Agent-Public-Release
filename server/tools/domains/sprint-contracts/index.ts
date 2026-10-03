/**
 * Tools-layer-split S25k — sprint-contracts domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers
 * the migrated handlers at import time. The 3 R115.5 "Sprint Contract" tools
 * (pin_done_condition, get_done_condition, evaluate_against_contract) migrate
 * their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { sprintContractsDomainTools } from "./handlers";

registerTools(sprintContractsDomainTools);

export {
  pinDoneConditionDefinition,
  getDoneConditionDefinition,
  evaluateAgainstContractDefinition,
  sprintContractsDomainDefinitions,
} from "./definitions";

export { sprintContractsDomainTools } from "./handlers";
