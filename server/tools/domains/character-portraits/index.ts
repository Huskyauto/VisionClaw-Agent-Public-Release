/**
 * Tools-layer-split character-portraits domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers
 * the migrated handlers at import time. Tools (S31): register_character_portrait
 * + list_character_portraits + init_character_portraits — thin wrappers over
 * server/video/portrait-registry.ts. SEAM: read-from-ctx (ctx.tenantId for the
 * fail-closed tenant guard + tenantId threaded into every portrait-registry
 * call). init_character_portraits injects the facade's executeTool callback via
 * a lazy back-edge (call-time dynamic import), same as the legacy arm.
 */
import { registerTools } from "../../registry";
import { characterPortraitsDomainTools } from "./handlers";

registerTools(characterPortraitsDomainTools);

export {
  registerCharacterPortraitDefinition,
  listCharacterPortraitsDefinition,
  initCharacterPortraitsDefinition,
  characterPortraitsDomainDefinitions,
} from "./definitions";

export { characterPortraitsDomainTools } from "./handlers";
