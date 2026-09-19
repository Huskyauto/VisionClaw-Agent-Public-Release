/**
 * Tools-layer-split S12 — browser domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registration happens in the domain index barrels as
 * they come online).
 */
import { registerTools } from "../../registry";
import { browserDomainTools } from "./handlers";

registerTools(browserDomainTools);

export {
  browserDefinition,
  stealthBrowseCamofoxDefinition,
  browserWorkflowDefinition,
  stealthBrowseDefinition,
  siteLoginDefinition,
  browserDomainDefinitions,
} from "./definitions";

export { browserDomainTools } from "./handlers";
