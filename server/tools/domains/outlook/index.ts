/**
 * Tools-layer-split S33 — outlook domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 3 tools (outlook_list_inbox / outlook_search_inbox
 * / outlook_read_message) migrate their definitions AND handlers.
 * Backed by server/lib/outlook + server/external-content-security.
 */
import { registerTools } from "../../registry";
import { outlookDomainTools } from "./handlers";

registerTools(outlookDomainTools);

export {
  outlookListInboxDefinition,
  outlookSearchInboxDefinition,
  outlookReadMessageDefinition,
  outlookDomainDefinitions,
} from "./definitions";

export { outlookDomainTools } from "./handlers";
