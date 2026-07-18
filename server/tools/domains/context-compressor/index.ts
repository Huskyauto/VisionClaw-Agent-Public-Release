/**
 * Tools-layer-split context-compressor domain barrel. Re-exports the definition
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handler at import time. Tool (S28): compress_context — a thin wrapper over
 * server/context-compressor.ts. SEAM: NONE (pure message-array transform, ctx
 * unused).
 */
import { registerTools } from "../../registry";
import { contextCompressorDomainTools } from "./handlers";

registerTools(contextCompressorDomainTools);

export {
  compressContextDefinition,
  contextCompressorDomainDefinitions,
} from "./definitions";

export { contextCompressorDomainTools } from "./handlers";
