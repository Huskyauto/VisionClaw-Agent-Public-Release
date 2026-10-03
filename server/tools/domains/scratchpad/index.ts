/**
 * Tools-layer-split S25o — scratchpad domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 2 delegation-scratchpad tools (write_scratchpad,
 * read_scratchpad) migrate their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { scratchpadDomainTools } from "./handlers";

registerTools(scratchpadDomainTools);

export {
  writeScratchpadDefinition,
  readScratchpadDefinition,
  scratchpadDomainDefinitions,
} from "./definitions";

export { scratchpadDomainTools } from "./handlers";
