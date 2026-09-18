/**
 * Tools-layer-split S33 — sessions domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 read-only tools (sessions_list / sessions_history)
 * migrate their definitions AND handlers; sessions_send + sessions_spawn stay
 * legacy (see definitions.ts header). Backed by server/sessions.
 */
import { registerTools } from "../../registry";
import { sessionsDomainTools } from "./handlers";

registerTools(sessionsDomainTools);

export {
  sessionsListDefinition,
  sessionsHistoryDefinition,
  sessionsDomainDefinitions,
} from "./definitions";

export { sessionsDomainTools } from "./handlers";
