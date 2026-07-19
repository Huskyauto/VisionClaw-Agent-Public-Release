/**
 * Tools-layer-split S21 — media domain barrel. Re-exports definitions for the
 * legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time. (generate_audio + create_slideshow_video definitions are
 * re-exported too, but their handlers stay in the legacy switch — see
 * handlers.ts header.)
 */
import { registerTools } from "../../registry";
import { mediaDomainTools } from "./handlers";

registerTools(mediaDomainTools);

export {
  generateAudioDefinition,
  produceVideoDefinition,
  planVideoProductionDefinition,
  createSlideshowVideoDefinition,
  mpegProduceDefinition,
  mpegProduceParallelDefinition,
  mpegConcatDefinition,
  mpegAddAudioDefinition,
  mediaDomainDefinitions,
} from "./definitions";

export { mediaDomainTools } from "./handlers";
