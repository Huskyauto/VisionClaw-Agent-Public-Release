/**
 * Tools-layer-split S8 — knowledge domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { knowledgeDomainTools } from "./handlers";

registerTools(knowledgeDomainTools);

export {
  searchKnowledgeDefinition,
  knowledgeNavigateDefinition,
  createKnowledgeDefinition,
  storeTripleDefinition,
  queryTriplesDefinition,
  expireTripleDefinition,
  docSearchDefinition,
  knowledgeDomainDefinitions,
} from "./definitions";

export { knowledgeDomainTools } from "./handlers";
