/**
 * Tools-layer-split S25r — monid domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time. The 4 Monid tools (monid_discover, monid_inspect, monid_run,
 * monid_catalog_browse) migrate their definitions AND handlers. Backed by
 * server/lib/monid (+ the free local catalog snapshot for catalog_browse).
 */
import { registerTools } from "../../registry";
import { monidDomainTools } from "./handlers";

registerTools(monidDomainTools);

export {
  monidDiscoverDefinition,
  monidInspectDefinition,
  monidRunDefinition,
  monidCatalogBrowseDefinition,
  monidDomainDefinitions,
} from "./definitions";

export { monidDomainTools } from "./handlers";
