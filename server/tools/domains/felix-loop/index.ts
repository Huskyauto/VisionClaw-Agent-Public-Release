/**
 * Tools-layer-split S25i — felix-loop domain barrel. Re-exports the definitions
 * for the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 7 Felix autonomous-loop tools (felix_loop_status,
 * list_felix_loop_runs, list_felix_proposals, approve_felix_proposal,
 * reject_felix_proposal, felix_loop_run_now, execute_felix_proposal) migrate
 * their definitions AND handlers.
 */
import { registerTools } from "../../registry";
import { felixLoopDomainTools } from "./handlers";

registerTools(felixLoopDomainTools);

export {
  felixLoopStatusDefinition,
  listFelixLoopRunsDefinition,
  listFelixProposalsDefinition,
  approveFelixProposalDefinition,
  rejectFelixProposalDefinition,
  felixLoopRunNowDefinition,
  executeFelixProposalDefinition,
  felixLoopDomainDefinitions,
} from "./definitions";

export { felixLoopDomainTools } from "./handlers";
