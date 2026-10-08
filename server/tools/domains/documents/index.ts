/**
 * Tools-layer-split S11 — documents domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registration happens in the domain index barrels as
 * they come online).
 */
import { registerTools } from "../../registry";
import { documentsDomainTools } from "./handlers";

registerTools(documentsDomainTools);

export {
  analyzePdfDefinition,
  createPdfDefinition,
  createStyledReportDefinition,
  fillPdfDefinition,
  createDocumentDefinition,
  createSpreadsheetDefinition,
  editPdfDefinition,
  listPdfFieldsDefinition,
  documentsDomainDefinitions,
} from "./definitions";

export { documentsDomainTools } from "./handlers";
