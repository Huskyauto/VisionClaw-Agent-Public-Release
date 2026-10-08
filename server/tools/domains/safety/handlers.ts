/**
 * Tools-layer-split S25w — safety-layer-domain migrated handlers.
 *
 * Selection: the 2 emotional-safety intervention tools — `detect_emotional_state`,
 * `grounding_intervention`. Both are backed solely by `server/safety-layer`
 * (`detectEmotionalState` / `generateGroundingIntervention`) — one coherent
 * shame-spiral detect → ground cluster. (`stress_intervention` calls a function
 * defined inside `server/tools.ts`, not a lib — stays legacy; `track_intervention`
 * reads `params._userId`, not carried by ToolContext — stays legacy; the fatigue
 * pair is backed by `server/skill-evolution`, a different lib — excluded.)
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM: neither legacy arm read ANY caller-supplied trust signal — they are pure
 * transforms of `params.message` / `params.intensity` / `params.patterns` /
 * `params.needs_immediate` / `params.previous_intervention_ids`. So there is NO
 * `_tenantId`/`_userId` seam to translate: `ctx` is unused (named `_ctx`), and the
 * bodies are copied verbatim. The backing `server/safety-layer` fns are SYNC.
 *
 * The backing `../../../safety-layer` module is pulled via call-time dynamic
 * `import(...)` — NOT a top-level static import — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  detectEmotionalStateDefinition,
  groundingInterventionDefinition,
} from "./definitions";

async function detectEmotionalStateHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { detectEmotionalState } = await import("../../../safety-layer");
  return detectEmotionalState(params.message || "");
}

async function groundingInterventionHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { generateGroundingIntervention } = await import("../../../safety-layer");
  const result = generateGroundingIntervention(
    {
      detected: true,
      intensity: (params.intensity as any) || "medium",
      patterns: Array.isArray(params.patterns) ? params.patterns : [],
      needsIntervention: true,
      needsImmediateIntervention: !!params.needs_immediate,
    },
    Array.isArray(params.previous_intervention_ids) ? params.previous_intervention_ids : [],
  );
  return result || { error: "No intervention available" };
}

/** Registered by ./index.ts at import time. */
export const safetyDomainTools: RegisteredTool[] = [
  defineTool(detectEmotionalStateDefinition, detectEmotionalStateHandler),
  defineTool(groundingInterventionDefinition, groundingInterventionHandler),
];
