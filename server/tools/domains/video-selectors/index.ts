/**
 * Tools-layer-split video-selectors domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Tools (S32): select_references_for_frame +
 * select_best_image — thin wrappers over
 * server/video/{reference-selector,best-image-selector}.ts. SEAM: read-from-ctx
 * (ctx.tenantId replaces the dispatcher-stripped params._tenantId).
 */
import { registerTools } from "../../registry";
import { videoSelectorsDomainTools } from "./handlers";

registerTools(videoSelectorsDomainTools);

export {
  selectReferencesForFrameDefinition,
  selectBestImageDefinition,
  videoSelectorsDomainDefinitions,
} from "./definitions";

export { videoSelectorsDomainTools } from "./handlers";
