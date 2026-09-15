/**
 * Tools-layer-split S25z — task-forces domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 4 tools (create_task_force / list_task_forces /
 * charge_task_force / sunset_task_force) migrate their definitions AND handlers.
 * Backed by server/agentic/task-forces.
 */
import { registerTools } from "../../registry";
import { taskForcesDomainTools } from "./handlers";

registerTools(taskForcesDomainTools);

export {
  createTaskForceDefinition,
  listTaskForcesDefinition,
  chargeTaskForceDefinition,
  sunsetTaskForceDefinition,
  taskForcesDomainDefinitions,
} from "./definitions";

export { taskForcesDomainTools } from "./handlers";
