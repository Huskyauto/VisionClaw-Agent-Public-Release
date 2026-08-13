/**
 * Tools-layer-split S25v — minerva-planner domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 3 tools (create_plan, list_plans,
 * get_plan) migrate their definitions AND handlers. Backed by
 * server/minerva-planner. (get_minerva_roster is NOT here — different backing lib.)
 */
import { registerTools } from "../../registry";
import { minervaDomainTools } from "./handlers";

registerTools(minervaDomainTools);

export {
  createPlanDefinition,
  listPlansDefinition,
  getPlanDefinition,
  minervaDomainDefinitions,
} from "./definitions";

export { minervaDomainTools } from "./handlers";
