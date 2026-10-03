/**
 * Tools-layer-split S23 — governance domain barrel. Re-exports the definition
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handler at import time. `set_policy`'s definition AND handler both migrate.
 */
import { registerTools } from "../../registry";
import { governanceDomainTools } from "./handlers";

registerTools(governanceDomainTools);

export {
  setPolicyDefinition,
  governanceDomainDefinitions,
} from "./definitions";

export { governanceDomainTools } from "./handlers";
