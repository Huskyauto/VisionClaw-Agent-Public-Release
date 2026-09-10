/**
 * Tools-layer-split google-workspace domain barrel. Re-exports the definition
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handler at import time. Tool (S34): google_workspace — a service/action
 * router over server/google-workspace.ts (Gmail, Calendar, Contacts, Sheets,
 * Docs, Slides). SEAM: read-from-ctx (ctx.tenantId replaces the
 * dispatcher-stripped params._tenantId).
 */
import { registerTools } from "../../registry";
import { googleWorkspaceDomainTools } from "./handlers";

registerTools(googleWorkspaceDomainTools);

export {
  googleWorkspaceDefinition,
  googleWorkspaceDomainDefinitions,
} from "./definitions";

export { googleWorkspaceDomainTools } from "./handlers";
