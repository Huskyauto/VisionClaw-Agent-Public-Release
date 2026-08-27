/**
 * Tools-layer-split S25x — design-doc domain barrel. Re-exports the definition
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handler at import time. The 1 tool (generate_design_doc) migrates its
 * definition AND handler. Backed by server/design-doc-tool.
 */
import { registerTools } from "../../registry";
import { designDocDomainTools } from "./handlers";

registerTools(designDocDomainTools);

export {
  generateDesignDocDefinition,
  designDocDomainDefinitions,
} from "./definitions";

export { designDocDomainTools } from "./handlers";
