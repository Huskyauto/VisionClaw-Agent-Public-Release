/**
 * Tools-layer-split codebase-graph domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Tools (S27): codebase_graph_query /
 * codebase_diff_impact (R98.27.8), thin wrappers over server/lib/codebase-graph.
 * SEAM: NONE — pure public-param, ctx unused (global repo artifact).
 */
import { registerTools } from "../../registry";
import { codebaseGraphDomainTools } from "./handlers";

registerTools(codebaseGraphDomainTools);

export {
  codebaseGraphQueryDefinition,
  codebaseDiffImpactDefinition,
  codebaseGraphDomainDefinitions,
} from "./definitions";

export { codebaseGraphDomainTools } from "./handlers";
