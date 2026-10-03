/**
 * Tools-layer-split S26f — content-ops-domain migrated handlers.
 *
 * Two content-operations tools — `lookup_output_skill`, `repurpose_content`. Each
 * handler body is a MECHANICAL move of the legacy switch arm (standing rules: no
 * renames, no behavior change, no added/removed gate). The strict XOR contract of
 * `lookup_output_skill` and the try-wrapped envelope of `repurpose_content` are
 * preserved VERBATIM.
 *
 * SEAM: PURE public-param relocation. These arms read NONE of the
 * dispatcher-stripped trust signals (`_tenantId`/`_personaId`/`_conversationId`/
 * `_projectId`) — grepped. `ctx` is therefore unused (kept in the signature for
 * handler-shape uniformity).
 *
 * The backing libs (`../../../lib/output-skills`, `../../../lib/content-repurposer`)
 * are pulled via call-time dynamic `import(...)` — NOT top-level static imports —
 * INSIDE the try (architect MED precedent: module-load failure returns the
 * {ok:false,error} envelope instead of throwing upward). The domain module thus
 * statically imports only within server/tools/ and cannot recurse back into the
 * app graph (acyclicity invariant, plan.md S2). Neither lib imports the tools
 * facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  lookupOutputSkillDefinition,
  repurposeContentDefinition,
} from "./definitions";

async function lookupOutputSkillHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  // R113.4 — On-demand scaffolding lookup. Pure local file read, no
  // tenant scope (templates are global), no money, no comms.
  // R113.4+sec — strict XOR contract: exactly one of (topic) XOR (department or persona).
  try {
    const hasTopic = params.topic !== undefined && params.topic !== null && String(params.topic).length > 0;
    const hasDept = params.department !== undefined && params.department !== null && String(params.department).length > 0;
    const hasPersona = params.persona !== undefined && params.persona !== null && String(params.persona).length > 0;
    const hasList = hasDept || hasPersona;
    if (hasTopic && hasList) {
      return { ok: false, error: "lookup_output_skill: pass EITHER {topic} OR {department/persona}, not both." };
    }
    if (!hasTopic && !hasList) {
      return { ok: false, error: "lookup_output_skill: pass {topic} to fetch a template, or {department} / {persona} to list available topics." };
    }
    const { lookupOutputSkill, listOutputSkills } = await import("../../../lib/output-skills");
    if (hasTopic) {
      return lookupOutputSkill(String(params.topic));
    }
    const dept = hasDept ? String(params.department) : undefined;
    const persona = hasPersona ? String(params.persona) : undefined;
    const list = listOutputSkills({ department: dept, persona });
    return {
      ok: true,
      filter: { department: dept, persona },
      count: list.length,
      topics: list.map((s) => ({ topic: s.topic, department: s.department, persona_fit: s.persona_fit })),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "lookup_output_skill failed" };
  }
}

async function repurposeContentHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  // R115.4 — Smart Import / cross-platform content repurposer.
  // Architect MED: dynamic import lives INSIDE try so module-load failure
  // returns the {ok:false,error} envelope instead of throwing upward.
  try {
    const { repurposeContent } = await import("../../../lib/content-repurposer");
    const r = await repurposeContent({
      sourceText: String(params.sourceText || ""),
      targetPlatforms: Array.isArray(params.targetPlatforms) ? params.targetPlatforms : [],
      brandVoice: params.brandVoice ? String(params.brandVoice) : undefined,
      callToAction: params.callToAction ? String(params.callToAction) : undefined,
    });
    return r;
  } catch (e: any) {
    return { ok: false, error: e?.message || "repurpose_content failed" };
  }
}

/** Registered by ./index.ts at import time. */
export const contentOpsDomainTools: RegisteredTool[] = [
  defineTool(lookupOutputSkillDefinition, lookupOutputSkillHandler),
  defineTool(repurposeContentDefinition, repurposeContentHandler),
];
