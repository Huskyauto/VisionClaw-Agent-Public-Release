/**
 * Tools-layer-split S26d — messaging domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 tools (send_message / messaging_status) migrate
 * their definitions AND handlers. Backed by server/messaging-gateway
 * (+ server/lib/outbound-redaction for send_message's outbound gate).
 */
import { registerTools } from "../../registry";
import { messagingDomainTools } from "./handlers";

registerTools(messagingDomainTools);

export {
  sendMessageDefinition,
  messagingStatusDefinition,
  messagingDomainDefinitions,
} from "./definitions";

export { messagingDomainTools } from "./handlers";
