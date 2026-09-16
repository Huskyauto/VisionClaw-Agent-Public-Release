/**
 * Tools-layer-split S10 — quality domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { qualityDomainTools } from "./handlers";

registerTools(qualityDomainTools);

export {
  sculptorReviewDefinition,
  verifyFelixProposalSpecDefinition,
  crossCritiqueDefinition,
  listCritiquesDefinition,
  critiqueResponseDefinition,
  qualityBaselineSaveDefinition,
  qualityBaselineCheckDefinition,
  verifyDeliverableDefinition,
  verifyMathChainDefinition,
  gradeDeliverableDefinition,
  verifyDeliveryProofDefinition,
  verifyWithCoveDefinition,
  qualityDomainDefinitions,
} from "./definitions";

export { qualityDomainTools } from "./handlers";
