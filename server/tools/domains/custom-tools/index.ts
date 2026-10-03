/**
 * Tools-layer-split S29 — custom-tools domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. Tools: create_tool, list_custom_tools,
 * delete_custom_tool — thin wrappers over server/tool-learning.ts. SEAM:
 * read-from-ctx (ctx.tenantId as the fail-closed tenant guard + threaded arg).
 */
import { registerTools } from "../../registry";
import { customToolsDomainTools } from "./handlers";

registerTools(customToolsDomainTools);

export {
  createToolDefinition,
  listCustomToolsDefinition,
  deleteCustomToolDefinition,
  customToolsDomainDefinitions,
} from "./definitions";

export { customToolsDomainTools } from "./handlers";
