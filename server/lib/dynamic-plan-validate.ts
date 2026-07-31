/**
 * server/lib/dynamic-plan-validate.ts
 *
 * R125+52.31 — Pure, dependency-free validation for Felix's dynamically composed
 * plans (see composeDynamicPlan in server/deliverable-contracts.ts). Kept in its
 * own module with a TYPE-ONLY import so unit tests can exercise the fail-closed
 * logic without pulling in the db pool (deliverable-contracts → llm-task →
 * harness-injection → db would otherwise hang node:test on an open pg handle).
 *
 * SAFETY (fail-CLOSED): a step survives ONLY if its `tool` is an exact member of
 * the live tool registry (`validNames`). Invented / unknown tool names are
 * dropped — naming a tool the planner imagined grants no execution path.
 */
import type { PipelineStep } from "../deliverable-contracts";

export interface RawDynamicStep {
  tool?: unknown;
  purpose?: unknown;
  inputs_hint?: unknown;
  required?: unknown;
}

/**
 * Filter LLM-proposed steps down to validated, ordered PipelineSteps.
 * - Drops any step whose `tool` is not in `validNames` (fail-closed).
 * - Caps the plan at `maxSteps`.
 * - Builds a sequential dependency chain (each step depends on the prior).
 * - Returns `[]` when no step survives — callers treat that as "no plan".
 */
export function buildValidatedDynamicSteps(
  rawSteps: RawDynamicStep[] | unknown,
  validNames: Set<string>,
  maxSteps = 8,
): PipelineStep[] {
  const list = Array.isArray(rawSteps) ? (rawSteps as RawDynamicStep[]) : [];
  const validated: PipelineStep[] = [];
  for (const s of list.slice(0, maxSteps)) {
    const tool = typeof s?.tool === "string" ? s.tool.trim() : "";
    if (!tool || !validNames.has(tool)) continue;
    const idx = validated.length;
    validated.push({
      tool,
      required: typeof s?.required === "boolean" ? s.required : true,
      purpose: typeof s?.purpose === "string" ? s.purpose.slice(0, 300) : "(step)",
      inputsHint: typeof s?.inputs_hint === "string" ? s.inputs_hint.slice(0, 300) : undefined,
      wave: idx + 1,
      dependsOn: idx === 0 ? [] : [idx - 1],
    });
  }
  return validated;
}
