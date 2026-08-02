/**
 * Tools-layer-split S25e — reasoning domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. All 7 "LuaN1aoAgent nuggets" reasoning tools
 * (attribute_failure, hypothesis_pin, hypothesis_list_pinned, plan_graph_edit,
 * plan_graph_query, hypothesis_attach_evidence, hypothesis_evidence_chain)
 * migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { reasoningDomainTools } from "./handlers";

registerTools(reasoningDomainTools);

export {
  attributeFailureDefinition,
  hypothesisPinDefinition,
  hypothesisListPinnedDefinition,
  planGraphEditDefinition,
  planGraphQueryDefinition,
  hypothesisAttachEvidenceDefinition,
  hypothesisEvidenceChainDefinition,
  reasoningDomainDefinitions,
} from "./definitions";

export { reasoningDomainTools } from "./handlers";
