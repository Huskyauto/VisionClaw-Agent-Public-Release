/**
 * Tools-layer-split S16 — outreach domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time.
 */
import { registerTools } from "../../registry";
import { outreachDomainTools } from "./handlers";

registerTools(outreachDomainTools);

export {
  enrichLeadDefinition,
  scoreLeadsDefinition,
  qualifyLeadsDefinition,
  createSequenceDefinition,
  enrollInSequenceDefinition,
  advanceSequenceDefinition,
  classifyReplyDefinition,
  listSequencesDefinition,
  outreachDomainDefinitions,
} from "./definitions";

export { outreachDomainTools } from "./handlers";
