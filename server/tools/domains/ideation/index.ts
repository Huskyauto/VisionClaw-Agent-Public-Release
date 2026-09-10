/**
 * Tools-layer-split S26e — ideation domain barrel. Re-exports the definition for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handler
 * at import time. The 1 tool (ideation_session) migrates its definition AND
 * handler. Backed by server/ideation-engine (+ server/storage for note/memory).
 */
import { registerTools } from "../../registry";
import { ideationDomainTools } from "./handlers";

registerTools(ideationDomainTools);

export {
  ideationSessionDefinition,
  ideationDomainDefinitions,
} from "./definitions";

export { ideationDomainTools } from "./handlers";
