/**
 * Tools-layer-split S26e — user-modeling domain barrel. Re-exports the definition
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handler at import time. The 1 tool (user_model_query) migrates its definition
 * AND handler. Backed by server/user-modeling.
 */
import { registerTools } from "../../registry";
import { userModelingDomainTools } from "./handlers";

registerTools(userModelingDomainTools);

export {
  userModelQueryDefinition,
  userModelingDomainDefinitions,
} from "./definitions";

export { userModelingDomainTools } from "./handlers";
