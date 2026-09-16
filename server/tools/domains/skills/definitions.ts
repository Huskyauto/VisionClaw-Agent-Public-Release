/**
 * Tools-layer-split S25h — skills-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical. The skill-synthesizer
 * cluster (self-improvement: propose / review / promote / reject reusable
 * skill playbooks).
 */

import type { ToolDefinition } from "../../types";

export const synthesizeSkillDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "synthesize_skill",
    description: "After successfully completing a complex task, propose a reusable skill (playbook) for next time a similar task arrives. Stored as a 'skill_candidate' awaiting human/supervisor approval. Personas should call this proactively when they notice a multi-step workflow that worked well — it makes the platform smarter over time.",
    parameters: {
      type: "object",
      properties: {
        taskSummary: { type: "string", description: "1-2 sentence summary of what was accomplished" },
        userMessage: { type: "string", description: "The original user request that started the task" },
        toolsUsed: { type: "array", items: { type: "string" }, description: "Names of tools called during the task (in order)" },
        outcome: { type: "string", description: "What was delivered and how it succeeded" },
      },
      required: ["taskSummary"],
    },
  },
};

export const listSkillCandidatesDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "list_skill_candidates",
    description: "Use when reviewing what the platform has LEARNED to do but hasn't been promoted to a formal skill yet — typically when Bob asks \"what is the system trying to teach itself\". Returns pending skill_candidate rows with name, evidence summary, and detected pattern. Felix or Bob then calls promote_skill_candidate to make permanent.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "approved", "rejected"], description: "Filter by status. Default draft." },
        personaId: { type: "number", description: "Filter to one persona's candidates" },
      },
    },
  },
};

export const promoteSkillCandidateDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "promote_skill_candidate",
    description: "Approve a skill_candidate and promote it to a live skill. Once promoted, it surfaces in the persona's skills documentation on next persona-sync. Use after reviewing a candidate from list_skill_candidates.",
    parameters: { type: "object", properties: { id: { type: "number", description: "Candidate id from list_skill_candidates" } }, required: ["id"] },
  },
};

export const rejectSkillCandidateDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "reject_skill_candidate",
    description: "Reject a skill_candidate so it does not pollute the skill library. Always include a brief reason for the rejection — helps the synthesizer learn what kinds of patterns are not worth saving.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Candidate id" },
        reason: { type: "string", description: "Short rejection reason" },
      },
      required: ["id"],
    },
  },
};

// Tools-layer-split S29 — manage_skills (skill CRUD) joins the skills domain.
// VERBATIM lift of the inline literal previously in server/tools.ts; backed by
// server/storage (skill rows) + server/auth (admin-tenant gate), not the
// skill-synthesizer lib the other four use.
export const manageSkillsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "manage_skills",
    description: "Create, list, update, enable/disable, or delete skills. Skills are reusable prompt instructions that teach you (or other agents) how to handle specific workflows, domains, or capabilities. Use 'create' to build a new skill when you encounter a task type you'll need again. Use 'list' to see what skills exist. Use 'update' to improve an existing skill's instructions. Use 'enable'/'disable' to toggle skills. Use 'delete' to remove a skill.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["create", "list", "update", "enable", "disable", "delete"], description: "The operation to perform" },
        id: { type: "number", description: "Skill ID (required for update, enable, disable, delete)" },
        name: { type: "string", description: "Skill name (required for create)" },
        description: { type: "string", description: "Short description of what the skill teaches (required for create)" },
        promptContent: { type: "string", description: "The full skill instructions — what to do, step-by-step, tool usage patterns, examples. This gets injected into the system prompt when the skill is active. (required for create, optional for update)" },
        category: { type: "string", description: "Category for organization (e.g., 'writing', 'coding', 'research', 'automation'). Default: 'general'" },
        icon: { type: "string", description: "Lucide icon name (e.g., 'Wrench', 'FileText', 'Code'). Default: 'Zap'" },
        personaId: { type: "number", description: "Optional: assign skill to a specific persona. Omit for global skills." },
      },
      required: ["command"],
    },
  },
};

export const skillsDomainDefinitions: ToolDefinition[] = [
  synthesizeSkillDefinition,
  listSkillCandidatesDefinition,
  promoteSkillCandidateDefinition,
  rejectSkillCandidateDefinition,
  manageSkillsDefinition,
];
