/**
 * Tools-layer-split S25h — skills-domain migrated handlers.
 *
 * Selection: the 4 contiguous skill-synthesizer tools (platform
 * self-improvement) — `synthesize_skill`, `list_skill_candidates`,
 * `promote_skill_candidate`, `reject_skill_candidate`. All backed by the single
 * `server/skill-synthesizer` module, one thematically coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). Seam edit:
 * the caller-supplied trust signal becomes the trusted `ctx` value (the
 * dispatcher strips + re-stamps it) — `params._tenantId`→`ctx.tenantId` (all 4,
 * numeric guard verbatim). The PUBLIC params (`params.taskSummary`,
 * `params.userMessage`, `params.toolsUsed`, `params.outcome`, `params.status`,
 * `params.personaId`, `params.id`, `params.reason`) stay verbatim `params`
 * reads — none is a trust signal (`params.personaId` here is the declared
 * public candidate-filter arg, NOT the `_personaId` trust key).
 * The backing dependency (`../../../skill-synthesizer`) is pulled via call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import —
 * so the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8/S9/S11/S25d/S25e/S25g used).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  synthesizeSkillDefinition,
  listSkillCandidatesDefinition,
  promoteSkillCandidateDefinition,
  rejectSkillCandidateDefinition,
  manageSkillsDefinition,
} from "./definitions";

async function synthesizeSkillHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for synthesize_skill" };
  const { synthesizeSkill } = await import("../../../skill-synthesizer");
  return await synthesizeSkill({
    taskSummary: params.taskSummary,
    userMessage: params.userMessage,
    toolsUsed: params.toolsUsed,
    outcome: params.outcome,
    tenantId: ctx.tenantId,
  });
}

async function listSkillCandidatesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for list_skill_candidates" };
  const { listSkillCandidates } = await import("../../../skill-synthesizer");
  const list = await listSkillCandidates(ctx.tenantId, { status: params.status || "draft", personaId: params.personaId });
  return { count: list.length, candidates: list };
}

async function promoteSkillCandidateHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for promote_skill_candidate" };
  const { promoteSkillCandidate } = await import("../../../skill-synthesizer");
  return await promoteSkillCandidate(params.id, ctx.tenantId);
}

async function rejectSkillCandidateHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for reject_skill_candidate" };
  const { rejectSkillCandidate } = await import("../../../skill-synthesizer");
  return await rejectSkillCandidate(params.id, params.reason, ctx.tenantId);
}

// Tools-layer-split S29 — manage_skills (skill CRUD): joins the skills domain.
// Body is a MECHANICAL move of the legacy switch arm (sub-command switch
// list/create/update/enable/disable/delete copied VERBATIM incl. every error
// string, default, and success message). SEAM (read-from-ctx): the arm read the
// dispatcher-stripped params._tenantId DIRECTLY for BOTH its fail-closed tenant
// guard AND its admin-tenant gate — migrated to ctx.tenantId with IDENTICAL
// checks. `_tenantId` is the ONLY stripped signal read (params.personaId here is
// the PUBLIC skill-assignment arg, NOT the _personaId trust key). Backed by
// server/storage (skill rows) + server/auth (ADMIN_TENANT_ID) — both pulled via
// call-time dynamic import (acyclic; neither imports the tools facade, grepped).
async function manageSkillsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { ADMIN_TENANT_ID: SKILLS_ADMIN_TID } = await import("../../../auth");
  const { storage } = await import("../../../storage");
  if (!ctx.tenantId) return { error: "Tenant context required for manage_skills" };
  if (ctx.tenantId !== SKILLS_ADMIN_TID) {
    return { error: "Admin access required. Skills are platform-wide and only the admin tenant can manage them." };
  }
  switch (params.command) {
    case "list": {
      const allSkills = await storage.getSkills();
      return { skills: allSkills.map((s: any) => ({ id: s.id, name: s.name, description: s.description, enabled: s.enabled, category: s.category, icon: s.icon, personaId: s.personaId, hasPrompt: !!s.promptContent })), count: allSkills.length };
    }
    case "create": {
      if (!params.name) return { error: "name is required to create a skill" };
      if (!params.description) return { error: "description is required to create a skill" };
      if (!params.promptContent) return { error: "promptContent is required — this is the instruction set injected into the system prompt" };
      const skill = await storage.createSkill({
        name: params.name,
        description: params.description,
        promptContent: params.promptContent,
        category: params.category || "general",
        icon: params.icon || "Zap",
        enabled: true,
        personaId: params.personaId ?? null,
      });
      return { success: true, skill: { id: skill.id, name: skill.name, description: skill.description, enabled: skill.enabled, category: skill.category }, message: `Skill "${skill.name}" created and enabled. It will be injected into the system prompt for all future conversations.` };
    }
    case "update": {
      if (!params.id) return { error: "id is required to update a skill" };
      const updates: any = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.description !== undefined) updates.description = params.description;
      if (params.promptContent !== undefined) updates.promptContent = params.promptContent;
      if (params.category !== undefined) updates.category = params.category;
      if (params.icon !== undefined) updates.icon = params.icon;
      if ("personaId" in params) updates.personaId = params.personaId ?? null;
      if (Object.keys(updates).length === 0) return { error: "No fields provided to update. Provide at least one of: name, description, promptContent, category, icon, personaId" };
      const updated = await storage.updateSkill(params.id, updates);
      if (!updated) return { error: `Skill ${params.id} not found` };
      return { success: true, skill: { id: updated.id, name: updated.name, enabled: updated.enabled }, message: `Skill "${updated.name}" updated.` };
    }
    case "enable": {
      if (!params.id) return { error: "id is required" };
      const enabled = await storage.updateSkill(params.id, { enabled: true });
      return enabled ? { success: true, message: `Skill "${enabled.name}" enabled.` } : { error: `Skill ${params.id} not found` };
    }
    case "disable": {
      if (!params.id) return { error: "id is required" };
      const disabled = await storage.updateSkill(params.id, { enabled: false });
      return disabled ? { success: true, message: `Skill "${disabled.name}" disabled.` } : { error: `Skill ${params.id} not found` };
    }
    case "delete": {
      if (!params.id) return { error: "id is required" };
      const existingSkills = await storage.getSkills();
      const exists = existingSkills.find((s: any) => s.id === params.id);
      if (!exists) return { error: `Skill ${params.id} not found` };
      await storage.deleteSkill(params.id);
      return { success: true, message: `Skill "${exists.name}" (ID ${params.id}) deleted.` };
    }
    default:
      return { error: `Unknown manage_skills command: ${params.command}. Use: create, list, update, enable, disable, delete` };
  }
}

/** Registered by ./index.ts at import time. */
export const skillsDomainTools: RegisteredTool[] = [
  defineTool(synthesizeSkillDefinition, synthesizeSkillHandler),
  defineTool(listSkillCandidatesDefinition, listSkillCandidatesHandler),
  defineTool(promoteSkillCandidateDefinition, promoteSkillCandidateHandler),
  defineTool(rejectSkillCandidateDefinition, rejectSkillCandidateHandler),
  defineTool(manageSkillsDefinition, manageSkillsHandler),
];
