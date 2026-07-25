/**
 * Verified Revenue Missions S5a — domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Born-migrated domain (contract:
 * data/feature-contracts/revenue-missions). Approve/kill are HITL-only —
 * deliberately not tools.
 */
import { registerTools } from "../../registry";
import { revenueMissionsDomainTools } from "./handlers";

registerTools(revenueMissionsDomainTools);

export {
  revenueMissionCreateDefinition,
  revenueMissionListDefinition,
  revenueMissionStatusDefinition,
  revenueMissionDraftExperimentDefinition,
  missionPortfolioReviewDefinition,
  revenueMissionsDomainDefinitions,
} from "./definitions";

export { revenueMissionsDomainTools } from "./handlers";
