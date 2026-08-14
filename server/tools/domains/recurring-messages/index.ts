/**
 * Tools-layer-split S26d — recurring-messages domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 3 tools (schedule_message /
 * list_scheduled_messages / cancel_scheduled_message) migrate their definitions AND
 * handlers. Backed by server/recurring-messages.
 */
import { registerTools } from "../../registry";
import { recurringMessagesDomainTools } from "./handlers";

registerTools(recurringMessagesDomainTools);

export {
  scheduleMessageDefinition,
  listScheduledMessagesDefinition,
  cancelScheduledMessageDefinition,
  recurringMessagesDomainDefinitions,
} from "./definitions";

export { recurringMessagesDomainTools } from "./handlers";
