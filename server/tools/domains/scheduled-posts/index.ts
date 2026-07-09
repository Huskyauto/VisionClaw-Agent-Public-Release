/**
 * Tools-layer-split — scheduled-posts domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time.
 */
import { registerTools } from "../../registry";
import { scheduledPostsDomainTools } from "./handlers";

registerTools(scheduledPostsDomainTools);

export {
  cancelScheduledPostDefinition,
  listScheduledPostsDefinition,
  scheduledPostsDomainDefinitions,
} from "./definitions";

export { scheduledPostsDomainTools } from "./handlers";
