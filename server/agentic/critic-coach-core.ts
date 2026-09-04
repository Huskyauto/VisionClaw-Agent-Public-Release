// Critic-Coach CORE — the pure, dependency-free pieces of the actor-critic /
// reflection step for the supervisor loop. Split out from critic-coach.ts so
// these helpers can be unit-tested WITHOUT pulling in ../providers (which loads
// ./storage and opens a pg pool → the node:test DB-pool-hang). critic-coach.ts
// re-exports everything here, so existing import sites are unaffected.

export interface CriticCoaching {
  ok: boolean;
  rootCause: string;
  guidance: string;
  doNotRepeat: string[];
}

export const COACH_SYSTEM_PROMPT = `You are a Critic-Coach for an autonomous agent that is STUCK. The agent attempted a task, it did not work, it retried, and it is now spinning — producing the same kind of non-progress output without succeeding.

You are NOT the agent. You are a fresh, independent second pair of eyes. Read the agent's GOAL, its STUCK SIGNAL, its LAST OUTPUT, and its RECENT STEPS. Diagnose the REAL reason it is failing to make progress and give it a concrete, different plan of attack.

Be specific and actionable. Do not restate the goal. Do not be encouraging. Identify the actual blocker (wrong tool, wrong assumption, missing precondition, malformed input, looping on the same dead approach, etc.) and tell the agent exactly what to do DIFFERENTLY next.

Output ONLY valid JSON:
{
  "root_cause": "<one or two sentences: the real reason it's stuck>",
  "guidance": "<concrete corrective plan: what to do differently on the next attempt, step by step if helpful>",
  "do_not_repeat": ["<specific dead-end approach to avoid>", "..."]
}`;

export type EscalationLevel = 0 | 1 | 2;

/**
 * Pure decision for the supervisor's stuck path — does the loop get a critic
 * coaching this turn, and what's the next escalation level? Extracted so the
 * executor's gating/clamp invariants are unit-testable without a DB or LLM.
 *
 *  - `shouldCoach` is true ONLY while the feature is enabled AND the per-run
 *    coaching cap has room (one-shot gating → bounds extra LLM spend).
 *  - `nextEscalationLevel` bumps toward a stronger tier by exactly one step,
 *    CLAMPED at 2, and NEVER downgrades an already-higher level. When no
 *    coaching happens the level is returned unchanged.
 */
export function decideStuckRecovery(state: {
  enabled: boolean;
  used: number;
  max: number;
  escalationLevel: number;
}): { shouldCoach: boolean; nextEscalationLevel: EscalationLevel } {
  const current = (Math.max(0, Math.min(2, Math.floor(state.escalationLevel || 0)))) as EscalationLevel;
  const shouldCoach = !!state.enabled && state.used < state.max;
  if (!shouldCoach) return { shouldCoach: false, nextEscalationLevel: current };
  const nextEscalationLevel = (current < 2 ? current + 1 : current) as EscalationLevel;
  return { shouldCoach: true, nextEscalationLevel };
}

/**
 * Build the synthetic history entry that carries the critic's guidance back
 * into the loop. Mirrored into `ctx.history` so history-driven routers surface
 * the coaching automatically (the executor router serializes `ctx.history`).
 * The `__critic_coach__` specialist marker makes it greppable in run traces.
 */
export function buildCoachHistoryEntry(
  stuckReason: string | undefined,
  c: CriticCoaching,
): { specialist: string; input: any; output: any } {
  return {
    specialist: "__critic_coach__",
    input: { stuckReason: stuckReason || "repeated non-progress output" },
    output: { rootCause: c.rootCause, guidance: c.guidance, doNotRepeat: c.doNotRepeat },
  };
}

/** Render coaching as a compact instruction block for prompt injection. */
export function renderCoaching(c: CriticCoaching): string {
  const lines = [
    "CRITIC-COACH FEEDBACK (an independent reviewer analyzed your stuck attempts):",
    `Root cause: ${c.rootCause || "(not identified)"}`,
    `Do this differently now: ${c.guidance}`,
  ];
  if (c.doNotRepeat.length > 0) {
    lines.push(`Do NOT repeat: ${c.doNotRepeat.map(d => `(${d})`).join("; ")}`);
  }
  lines.push("You are now on a stronger model. Use this guidance to take a genuinely different approach — do not repeat the dead-end above.");
  return lines.join("\n");
}
