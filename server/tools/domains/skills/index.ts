/**
 * Tools-layer-split S25h — skills domain barrel. Re-exports the definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time. The 4 skill-synthesizer self-improvement tools
 * (synthesize_skill, list_skill_candidates, promote_skill_candidate,
 * reject_skill_candidate) migrate their definitions AND handlers.
 *
 * S29 — manage_skills (skill CRUD) joins the domain, backed by server/storage +
 * server/auth (admin-tenant gate) rather than the skill-synthesizer lib.
 */
import { registerTools } from "../../registry";
import { skillsDomainTools } from "./handlers";

registerTools(skillsDomainTools);

export {
  synthesizeSkillDefinition,
  listSkillCandidatesDefinition,
  promoteSkillCandidateDefinition,
  rejectSkillCandidateDefinition,
  manageSkillsDefinition,
  skillsDomainDefinitions,
} from "./definitions";

export { skillsDomainTools } from "./handlers";
