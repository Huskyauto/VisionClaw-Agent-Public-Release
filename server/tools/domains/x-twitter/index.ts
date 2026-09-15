/**
 * Tools-layer-split S15 — x-twitter domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registration happens in the domain index barrels as
 * they come online).
 */
import { registerTools } from "../../registry";
import { xTwitterDomainTools } from "./handlers";

registerTools(xTwitterDomainTools);

export {
  xPostTweetDefinition,
  xDeleteTweetDefinition,
  xGetTweetDefinition,
  xGetMentionsDefinition,
  xGetTimelineDefinition,
  xSearchDefinition,
  xLikeTweetDefinition,
  xRetweetDefinition,
  xGetMeDefinition,
  xTwitterDomainDefinitions,
} from "./definitions";

export { xTwitterDomainTools } from "./handlers";
