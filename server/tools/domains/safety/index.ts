/**
 * Tools-layer-split S25w — safety-layer domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 tools (detect_emotional_state,
 * grounding_intervention) migrate their definitions AND handlers. Backed by
 * server/safety-layer. (stress_intervention + track_intervention stay legacy;
 * the fatigue pair is a different lib — see handlers.ts header.)
 */
import { registerTools } from "../../registry";
import { safetyDomainTools } from "./handlers";

registerTools(safetyDomainTools);

export {
  detectEmotionalStateDefinition,
  groundingInterventionDefinition,
  safetyDomainDefinitions,
} from "./definitions";

export { safetyDomainTools } from "./handlers";
