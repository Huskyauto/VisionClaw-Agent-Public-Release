/**
 * Tools-layer-split S18 — legal domain barrel. Re-exports definitions for the
 * legacy facade TOOL_DEFINITIONS splice, and registers the migrated handlers at
 * import time.
 */
import { registerTools } from "../../registry";
import { legalDomainTools } from "./handlers";

registerTools(legalDomainTools);

export {
  createContractDefinition,
  listContractsDefinition,
  updateContractStatusDefinition,
  legalReviewDefinition,
  generateLegalDocumentDefinition,
  legalDomainDefinitions,
} from "./definitions";

export { legalDomainTools } from "./handlers";
