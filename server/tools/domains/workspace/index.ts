/**
 * Tools-layer-split S13 — workspace domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registration happens in the domain index barrels as
 * they come online).
 */
import { registerTools } from "../../registry";
import { workspaceDomainTools } from "./handlers";

registerTools(workspaceDomainTools);

export {
  workspaceInitDefinition,
  workspaceUpdateStatusDefinition,
  workspaceLogArtifactDefinition,
  workspaceReadDefinition,
  workspaceFinalizeDefinition,
  workspaceListDefinition,
  workspaceDomainDefinitions,
} from "./definitions";

export { workspaceDomainTools } from "./handlers";
