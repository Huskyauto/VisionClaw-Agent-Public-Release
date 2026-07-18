/**
 * escalation-valve.ts — Metered Escalation Valve (Anvil/Wayland "smart loops"
 * borrow, verdict 2026-07-17).
 *
 * Discipline: when a cheap-model repair loop STALLS (prior-collapse — the
 * proposer keeps re-emitting a semantically identical failed diff), spend
 * exactly ONE frontier-model turn on JUDGMENT ONLY — a diagnosis of why the
 * loop is stuck and which direction to try instead — then demote back to the
 * cheap loop. The frontier model never types the fix; it unblocks, the cheap
 * model grinds. Capped at one fire per runRepoSurgeon invocation.
 *
 * Valve fires are recorded inside the collapse attempt's outcome_detail
 * (`valve` key) in repo_surgeon_attempts — no new table — so the
 * valve-fire-rate stat on /admin/ecosystem-health is computable from data we
 * already persist (same no-new-write-path stance as Harness Health).
 *
 * Fail-OPEN: any error/timeout returns null and the loop proceeds exactly as
 * before (perturbation directive only). The valve is an efficiency aid, never
 * a gate.
 */

import { runLlmTask } from "../llm-task";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { logSilentCatch } from "../lib/silent-catch";
import type { RepoSurgeonIncident } from "./repo-surgeon";

/** One diagnostic turn only — keep the reserve reserved. */
export const VALVE_MODEL = process.env.ESCALATION_VALVE_MODEL || "claude-opus-4-8";
const VALVE_TIMEOUT_MS = 90_000;

export interface ValveDiagnosis {
  /** Why the cheap loop is stuck (root confusion, missing context, wrong frame). */
  stallDiagnosis: string;
  /** Concrete alternative direction for the NEXT cheap attempt (not a diff). */
  suggestedDirection: string;
  model: string;
}

const VALVE_SCHEMA = {
  type: "object",
  required: ["stallDiagnosis", "suggestedDirection"],
  properties: {
    stallDiagnosis: {
      type: "string",
      description: "WHY the repair loop is stalled: what the cheap model keeps misunderstanding or missing.",
    },
    suggestedDirection: {
      type: "string",
      description: "A concrete DIFFERENT direction for the next attempt (different root-cause hypothesis, different file, different fix shape). NOT a diff — judgment only.",
    },
  },
};

/**
 * One frontier diagnostic turn on a genuine stall. Judgment only — the return
 * value is fed back into the next CHEAP propose call as feedback text.
 * Fail-open: returns null on any failure.
 */
export async function fireEscalationValve(
  incident: RepoSurgeonIncident,
  stallContext: string,
): Promise<ValveDiagnosis | null> {
  try {
    const prompt = `You are the SENIOR ON CALL for an automated repair loop. A cheaper model has stalled: it keeps re-proposing a semantically identical fix that already failed. You get ONE diagnostic turn. Do NOT write the fix — diagnose the stall and point the next attempt in a genuinely different direction.

INCIDENT
- Stage: ${incident.stage || "(unknown)"}
- Error: ${(incident.error || "(none)").slice(0, 2000)}
- Implicated files: ${(incident.candidateFiles || []).join(", ") || "(none)"}

STALL CONTEXT (the repeated failed proposal + failure feedback):
${stallContext.slice(0, 4000)}

Output ONLY a JSON object: { stallDiagnosis, suggestedDirection }. Be specific — name the alternative hypothesis or file, not generic advice.`;

    const res = await runLlmTask({
      prompt,
      schema: VALVE_SCHEMA,
      model: VALVE_MODEL,
      temperature: 0.2,
      thinking: "high",
      timeoutMs: VALVE_TIMEOUT_MS,
      maxTokens: 2048,
      // Platform-level self-repair — bill to admin (R64.C precedent).
      tenantId: ADMIN_TENANT_ID,
    });
    if (!res.success || !res.json) return null;
    const j = res.json as any;
    const stallDiagnosis = String(j.stallDiagnosis || "").trim();
    const suggestedDirection = String(j.suggestedDirection || "").trim();
    if (!stallDiagnosis || !suggestedDirection) return null;
    return { stallDiagnosis, suggestedDirection, model: VALVE_MODEL };
  } catch (e) {
    logSilentCatch("server/agentic/escalation-valve.ts", e);
    return null;
  }
}
