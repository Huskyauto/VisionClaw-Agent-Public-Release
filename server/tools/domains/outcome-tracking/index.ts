/**
 * Tools-layer-split S26e — outcome-tracking domain barrel. Re-exports the
 * definition for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handler at import time. The 1 tool (track_outcome) migrates its
 * definition AND handler. Backed by server/outcome-tracker.
 */
import { registerTools } from "../../registry";
import { outcomeTrackingDomainTools } from "./handlers";

registerTools(outcomeTrackingDomainTools);

export {
  trackOutcomeDefinition,
  outcomeTrackingDomainDefinitions,
} from "./definitions";

export { outcomeTrackingDomainTools } from "./handlers";
