/**
 * Tools-layer-split S5 — files domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { filesDomainTools } from "./handlers";

registerTools(filesDomainTools);

export {
  readOutputBlobDefinition,
  codeSliceDefinition,
  scanFileDefinition,
  readFileDefinition,
  writeFileDefinition,
  listUploadsDefinition,
  googleDriveDefinition,
  filesDomainDefinitions,
} from "./definitions";

export { filesDomainTools } from "./handlers";
