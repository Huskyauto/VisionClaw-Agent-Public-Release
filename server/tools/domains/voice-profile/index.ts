/**
 * Tools-layer-split S25y — voice-profile domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 tools (build_voice_profile / get_voice_profile)
 * migrate their definitions AND handlers. Backed by server/martech-bundle.
 */
import { registerTools } from "../../registry";
import { voiceProfileDomainTools } from "./handlers";

registerTools(voiceProfileDomainTools);

export {
  buildVoiceProfileDefinition,
  getVoiceProfileDefinition,
  voiceProfileDomainDefinitions,
} from "./definitions";

export { voiceProfileDomainTools } from "./handlers";
