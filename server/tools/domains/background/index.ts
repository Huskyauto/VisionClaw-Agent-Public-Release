/**
 * Tools-layer-split S25u — background-tasks domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 3 tools (run_background_task,
 * check_background_task, list_background_tasks) migrate their definitions AND
 * handlers. Backed by server/background-tasks.
 */
import { registerTools } from "../../registry";
import { backgroundDomainTools } from "./handlers";

registerTools(backgroundDomainTools);

export {
  runBackgroundTaskDefinition,
  checkBackgroundTaskDefinition,
  listBackgroundTasksDefinition,
  backgroundDomainDefinitions,
} from "./definitions";

export { backgroundDomainTools } from "./handlers";
