/**
 * Tools-layer-split S14 — social domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registration happens in the domain index barrels as
 * they come online).
 */
import { registerTools } from "../../registry";
import { socialDomainTools } from "./handlers";

registerTools(socialDomainTools);

export {
  generateHooksDefinition,
  formatPostDefinition,
  generateContentMatrixDefinition,
  scorePostDefinition,
  socialDomainDefinitions,
} from "./definitions";

export { socialDomainTools } from "./handlers";
