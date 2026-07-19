/**
 * Tools-layer-split S20 — agentic domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time.
 */
import { registerTools } from "../../registry";
import { agenticDomainTools } from "./handlers";

registerTools(agenticDomainTools);

export {
  selfHealDefinition,
  selfHealLogDefinition,
  selfHealInspectDefinition,
  agenticDomainDefinitions,
} from "./definitions";

export { agenticDomainTools } from "./handlers";
