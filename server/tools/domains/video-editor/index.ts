/**
 * Tools-layer-split video-editor domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Tools (S30): video_transcribe_words +
 * video_cut_fillers + video_burn_captions — thin wrappers over
 * server/video-editor.ts. SEAM: NONE (public params only; no stripped trust
 * signal read).
 */
import { registerTools } from "../../registry";
import { videoEditorDomainTools } from "./handlers";

registerTools(videoEditorDomainTools);

export {
  videoTranscribeWordsDefinition,
  videoCutFillersDefinition,
  videoBurnCaptionsDefinition,
  videoEditorDomainDefinitions,
} from "./definitions";

export { videoEditorDomainTools } from "./handlers";
