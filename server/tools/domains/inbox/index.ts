/**
 * Tools-layer-split S25g — inbox domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 4 R104 inbox quarantine + sender-allowlist tools
 * (inbox_sender_approve, inbox_sender_block, inbox_quarantine_list,
 * inbox_allowlist_list) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { inboxDomainTools } from "./handlers";

registerTools(inboxDomainTools);

export {
  inboxSenderApproveDefinition,
  inboxSenderBlockDefinition,
  inboxQuarantineListDefinition,
  inboxAllowlistListDefinition,
  inboxDomainDefinitions,
} from "./definitions";

export { inboxDomainTools } from "./handlers";
