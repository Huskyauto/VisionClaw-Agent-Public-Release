/**
 * Tools-layer-split S26e — knowledge-nudges domain barrel. Re-exports the
 * definition for the legacy facade's TOOL_DEFINITIONS splice, and registers the
 * migrated handler at import time. The 1 tool (knowledge_nudge_stats) migrates its
 * definition AND handler. Backed by server/knowledge-nudges.
 */
import { registerTools } from "../../registry";
import { knowledgeNudgesDomainTools } from "./handlers";

registerTools(knowledgeNudgesDomainTools);

export {
  knowledgeNudgeStatsDefinition,
  knowledgeNudgesDomainDefinitions,
} from "./definitions";

export { knowledgeNudgesDomainTools } from "./handlers";
