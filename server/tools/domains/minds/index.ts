/**
 * Tools-layer-split minds domain barrel. Re-exports the definitions for the
 * legacy facade's TOOL_DEFINITIONS splice, and registers the migrated handlers
 * at import time. Tools (S28): create_mind + mind_ticket — command-dispatch
 * wrappers over server/minds-engine.ts. SEAM: read-from-ctx (ctx.tenantId for
 * the admin-gate + tenant guard + local tenantId threaded to minds-engine).
 */
import { registerTools } from "../../registry";
import { mindsDomainTools } from "./handlers";

registerTools(mindsDomainTools);

export {
  createMindDefinition,
  mindTicketDefinition,
  mindsDomainDefinitions,
} from "./definitions";

export { mindsDomainTools } from "./handlers";
