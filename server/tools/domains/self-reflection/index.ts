/**
 * Tools-layer-split S25p — self-reflection domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 2 self-awareness tools (introspect_tools,
 * self_diagnose) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { selfReflectionDomainTools } from "./handlers";

registerTools(selfReflectionDomainTools);

export {
  introspectToolsDefinition,
  selfDiagnoseDefinition,
  selfReflectionDomainDefinitions,
} from "./definitions";

export { selfReflectionDomainTools } from "./handlers";
