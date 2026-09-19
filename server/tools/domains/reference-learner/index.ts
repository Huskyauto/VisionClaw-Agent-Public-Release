/**
 * Tools-layer-split S26c — reference-learner domain barrel. Re-exports the
 * definitions for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handlers at import time. The 2 tools (learn_from_reference /
 * recall_references) migrate their definitions AND handlers.
 * Backed by server/reference-learner.
 */
import { registerTools } from "../../registry";
import { referenceLearnerDomainTools } from "./handlers";

registerTools(referenceLearnerDomainTools);

export {
  learnFromReferenceDefinition,
  recallReferencesDefinition,
  referenceLearnerDomainDefinitions,
} from "./definitions";

export { referenceLearnerDomainTools } from "./handlers";
