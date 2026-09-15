/**
 * Tools-layer-split S7 — memory domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { memoryDomainTools } from "./handlers";

registerTools(memoryDomainTools);

export {
  searchMemoryDefinition,
  createMemoryDefinition,
  rememberForThisSessionDefinition,
  updateMemoryDefinition,
  recallContextDefinition,
  graphMemoryDefinition,
  getUnifiedMemoryContextDefinition,
  memoryGeometryScanDefinition,
  memoryDomainDefinitions,
} from "./definitions";

export { memoryDomainTools } from "./handlers";
