/**
 * Tools-layer-split S25k — research-intel domain barrel. Re-exports definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 9 tools are the research + competitor-intel + ICP
 * arms that remained in the shared `./agentic-features` fnMap block after S16
 * split the 8 outreach labels off the tail.
 */
import { registerTools } from "../../registry";
import { researchIntelDomainTools } from "./handlers";

registerTools(researchIntelDomainTools);

export {
  saveEvidenceDefinition,
  queryEvidenceDefinition,
  synthesizeResearchDefinition,
  addCompetitorDefinition,
  listCompetitorsDefinition,
  takeCompetitorSnapshotDefinition,
  detectCompetitorChangesDefinition,
  competitorBriefingDefinition,
  defineIcpDefinition,
  researchIntelDomainDefinitions,
} from "./definitions";

export { researchIntelDomainTools } from "./handlers";
