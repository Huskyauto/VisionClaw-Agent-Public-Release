/**
 * Tools-layer-split — procedures domain barrel. Re-exports definitions for the
 * legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time.
 */
import { registerTools } from "../../registry";
import { proceduresDomainTools } from "./handlers";

registerTools(proceduresDomainTools);

export {
  listProcedureEditsDefinition,
  applyProcedureEditDefinition,
  rollbackProcedureEditDefinition,
  proceduresDomainDefinitions,
} from "./definitions";

export { proceduresDomainTools } from "./handlers";
