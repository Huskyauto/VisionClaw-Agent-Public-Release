/**
 * Tools-layer-split code-chunker domain barrel. Re-exports the definition for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handler at import time. Tool (S27): chunk_code (cAST), a wrapper over
 * server/code-chunker. SEAM: NONE — pure public-param, ctx unused
 * (filesystem-scoped safety, not tenant-scoped).
 */
import { registerTools } from "../../registry";
import { codeChunkerDomainTools } from "./handlers";

registerTools(codeChunkerDomainTools);

export {
  chunkCodeDefinition,
  codeChunkerDomainDefinitions,
} from "./definitions";

export { codeChunkerDomainTools } from "./handlers";
