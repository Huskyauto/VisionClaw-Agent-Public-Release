// Server-authoritative backstop for the bounded K-step grader-driven revise loop
// (see server/agentic/grade-decision.ts). grade_deliverable is a stateless tool:
// the caller (an LLM/persona) is TOLD via next_step to thread `attempt` +
// `prev_scores` back on each re-grade. A cooperative caller keeps the loop
// bounded; a confused or adversarial one could reset attempt=1 / drop
// prev_scores on every call and revise forever. This module makes the bound
// NOT depend on caller honesty: it tracks the real attempt count + score
// trajectory per (tenant, conversation, deliverable-type) key and reconciles the
// caller-supplied (untrusted) values against it, NEVER shrinking.
//
// Fail-closed posture: the authoritative attempt is max(caller, server+1) and
// the authoritative trajectory is the longer of caller-vs-server — a caller can
// only make the loop escalate SOONER, never run longer. State is process-local
// and TTL-evicted; if it is lost (restart / different process) the caller-
// supplied bound (default 3) still applies, so the worst case degrades to the
// pre-backstop behavior, never to an unbounded loop weaker than that.
//
// SCOPE / residual (deliberate, auditable). This is an INTERNAL quality loop —
// grade_deliverable is a persona tool driven by Felix during deliverable
// production, not a public endpoint — so the adversary is a confused/over-eager
// LLM, not an external attacker. This backstop closes the practical caller-reset
// bypass within a live production turn (grades happen seconds/minutes apart, well
// inside the eviction window). The residual it does NOT close alone — a caller
// spacing grades beyond the window, or a mid-loop process restart/instance
// change resetting attempts — is bounded at the SYSTEM level by the platform's
// existing outer ceilings that gate ALL agent work regardless of this component:
// per-turn round limits, the ~25k/day reflexive-loop ceiling, completion-
// verification budget ceilings, and daily $ caps. So the loop is genuinely
// bounded end-to-end; a truly reset-proof per-run bound would need a durable
// store (DB) keyed by a stable run id threaded through the deliverable pipeline —
// a schema + plumbing change deferred as an optional upgrade, not built here
// because it is disproportionate for an already-multiply-bounded internal loop.

export interface ReviseLoopState {
  /** highest authoritative attempt number seen for this key. */
  attempt: number;
  /** authoritative score trajectory, oldest→newest. */
  scores: number[];
  /** epoch ms of the last update (for TTL eviction). */
  updatedAt: number;
}

const STORE = new Map<string, ReviseLoopState>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6 h — abandoned loops evict same-day; a live
// deliverable loop completes in minutes, so this makes time-spacing the attempt
// bound past the window implausible while still reclaiming truly-abandoned keys.
const MAX_ENTRIES = 5000; // hard cap so a flood of keys can't grow unbounded

/**
 * Stable key for one deliverable's revise loop. Only meaningful when a
 * conversationId is present (the chat/persona path where the loop actually
 * runs); callers without one should skip the backstop and rely on the pure
 * caller-supplied bound.
 */
export function reviseLoopKey(
  tenantId: number,
  conversationId: number,
  deliverableType: string,
): string {
  return `${tenantId}:${conversationId}:${(deliverableType || "").toLowerCase().trim()}`;
}

function evictStale(now: number): void {
  for (const [k, v] of STORE) {
    if (now - v.updatedAt > TTL_MS) STORE.delete(k);
  }
  // If still over the cap after TTL eviction, drop the oldest entries.
  if (STORE.size > MAX_ENTRIES) {
    const sorted = [...STORE.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < STORE.size - MAX_ENTRIES; i++) STORE.delete(sorted[i][0]);
  }
}

/**
 * Reconcile caller-supplied (untrusted) attempt/priorScores against the
 * authoritative server-tracked state for `key`. Returns the values to feed
 * resolveGradeDecision. NEVER shrinks: attempt = max(caller, server+1), and the
 * trajectory is whichever of caller/server is longer. This is what closes the
 * "reset attempt=1 each call" bypass — the server's own count keeps climbing.
 */
export function reconcileReviseAttempt(
  key: string,
  callerAttempt: number | undefined,
  callerPriorScores: number[] | undefined,
  now: number = Date.now(),
): { attempt: number; priorScores: number[] } {
  evictStale(now);
  const prev = STORE.get(key);
  const serverCount = prev?.attempt ?? 0;
  const rawCaller = Number(callerAttempt);
  const caller = Number.isFinite(rawCaller) && rawCaller >= 1 ? Math.floor(rawCaller) : 1;
  const attempt = Math.max(caller, serverCount + 1);

  const callerScores = Array.isArray(callerPriorScores)
    ? callerPriorScores.map(Number).filter((n) => Number.isFinite(n))
    : [];
  const serverScores = prev?.scores ?? [];
  const priorScores = serverScores.length >= callerScores.length ? serverScores : callerScores;

  return { attempt, priorScores };
}

/**
 * Record the outcome of a grade for `key`. When the loop ENDED (passed or
 * escalated) the key is cleared so a genuinely new deliverable of the same type
 * in the same conversation starts fresh. While the loop continues, the attempt +
 * appended score are persisted as the new authoritative state.
 */
export function recordReviseOutcome(
  key: string,
  attempt: number,
  priorScores: number[],
  score: number,
  loopEnded: boolean,
  now: number = Date.now(),
): void {
  if (loopEnded) {
    STORE.delete(key);
    return;
  }
  const s = Number(score);
  const scores = [...priorScores, Number.isFinite(s) ? s : 0];
  STORE.set(key, { attempt, scores, updatedAt: now });
}

/** Test-only: clear all tracked loop state between cases. */
export function __resetReviseTrackerForTest(): void {
  STORE.clear();
}
