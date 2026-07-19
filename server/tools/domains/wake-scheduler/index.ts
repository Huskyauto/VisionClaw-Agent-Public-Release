/**
 * Tools-layer-split S26c — wake-scheduler domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 3 tools (schedule_wake / cancel_wake /
 * list_wakes) migrate their definitions AND handlers.
 * Backed by server/agentic/wake-scheduler.
 */
import { registerTools } from "../../registry";
import { wakeSchedulerDomainTools } from "./handlers";

registerTools(wakeSchedulerDomainTools);

export {
  scheduleWakeDefinition,
  cancelWakeDefinition,
  listWakesDefinition,
  wakeSchedulerDomainDefinitions,
} from "./definitions";

export { wakeSchedulerDomainTools } from "./handlers";
