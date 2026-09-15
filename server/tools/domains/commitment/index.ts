/**
 * Tools-layer-split S25d — commitment domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. All 5 `commitment_*` definitions AND handlers migrate.
 */
import { registerTools } from "../../registry";
import { commitmentDomainTools } from "./handlers";

registerTools(commitmentDomainTools);

export {
  commitmentCreateDefinition,
  commitmentListDefinition,
  commitmentHeartbeatDefinition,
  commitmentCompleteDefinition,
  commitmentCancelDefinition,
  commitmentDomainDefinitions,
} from "./definitions";

export { commitmentDomainTools } from "./handlers";
