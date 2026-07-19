import { createRun, appendStep, completeRun, failRun, type RunStep } from "./runs";
import { renderFailureContract } from "./failure-contract";

export interface Branch<TInput, TOutput> {
  id: string;
  input: TInput;
  fn: (input: TInput) => Promise<TOutput>;
}

export interface BranchResult<TOutput> {
  id: string;
  success: boolean;
  value?: TOutput;
  error?: string;
  durationMs: number;
}

/**
 * Send-style dynamic fan-out: run a list of branches in parallel with bounded concurrency.
 * Unlike Promise.all this is resilient — one branch failing does not cancel the others,
 * and results are returned with per-branch status.
 */
export async function runParallel<TInput, TOutput>(params: {
  tenantId: number;
  goal: string;
  branches: Branch<TInput, TOutput>[];
  concurrency?: number;
  parentRunId?: number | null;
}): Promise<{ runId: number; results: BranchResult<TOutput>[] }> {
  const concurrency = Math.max(1, Math.min(params.concurrency ?? 4, 16));
  const run = await createRun({
    tenantId: params.tenantId,
    runType: "parallel",
    goal: params.goal,
    state: { total: params.branches.length, concurrency },
    parentRunId: params.parentRunId ?? null,
  });

  try {
    const results: BranchResult<TOutput>[] = new Array(params.branches.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= params.branches.length) return;
        const branch = params.branches[idx];
        const start = Date.now();
        try {
          await appendStep(run.id, { at: new Date().toISOString(), step: `branch:${branch.id}`, status: "started" });
          const value = await branch.fn(branch.input);
          const durationMs = Date.now() - start;
          results[idx] = { id: branch.id, success: true, value, durationMs };
          await appendStep(run.id, { at: new Date().toISOString(), step: `branch:${branch.id}`, status: "completed", durationMs });
        } catch (err: any) {
          const durationMs = Date.now() - start;
          results[idx] = { id: branch.id, success: false, error: err?.message || String(err), durationMs };
          await appendStep(run.id, { at: new Date().toISOString(), step: `branch:${branch.id}`, status: "failed", detail: err?.message, durationMs });
        }
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    const successCount = results.filter(r => r.success).length;
    await completeRun(run.id, {
      total: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
      results: results.map(r => ({ id: r.id, success: r.success, durationMs: r.durationMs, error: r.error })),
    });

    return { runId: run.id, results };
  } catch (err: any) {
    await failRun(run.id, `runParallel orchestration error: ${err?.message || String(err)}`);
    throw err;
  }
}

/**
 * Supervisor pattern: one router LLM decides which specialist to dispatch at each turn.
 * Specialists return results, router decides next action or terminates.
 */
export interface Specialist<TInput, TOutput> {
  name: string;
  description: string;
  handler: (input: TInput, context: SupervisorContext) => Promise<TOutput>;
}

export interface SupervisorContext {
  runId: number;
  history: { specialist: string; input: any; output: any }[];
  log: (msg: string, detail?: any) => Promise<void>;
  /** Set to >0 once `escalateAfterTurn` is reached. Routers/specialists should
   *  read this and promote to a stronger model tier. 0=normal, 1=escalated,
   *  2=critical (used by self-heal to map to Tier 2/3 of the heal escalation). */
  escalationLevel?: 0 | 1 | 2;
  /** Actor-critic feedback (2026-06-19): when the loop gets stuck (spinning
   *  with no success), an independent critic LLM diagnoses why and writes a
   *  corrective plan here. Routers/specialists that read this should take a
   *  genuinely DIFFERENT approach on the next turn. Also mirrored into
   *  `history` as a `__critic_coach__` entry so history-driven routers pick it
   *  up automatically. Paired with an `escalationLevel` bump (Combined mode). */
  criticGuidance?: string;
}

export interface SupervisorDecision {
  action: "dispatch" | "finish";
  specialist?: string;
  input?: any;
  reason?: string;
  finalAnswer?: string;
}

export async function runSupervisor<TOutput>(params: {
  tenantId: number;
  goal: string;
  specialists: Specialist<any, any>[];
  router: (ctx: SupervisorContext) => Promise<SupervisorDecision>;
  maxTurns?: number;
  parentRunId?: number | null;
  /** Inspired by OpenSwarm: after this many turns without finishing, log
   *  an escalation signal so downstream model selection can promote to a
   *  stronger model (handled in self-heal.ts tier table). */
  escalateAfterTurn?: number;
  /** Stop early if the StuckDetector flags repeated identical outputs. */
  stuckDetectionEnabled?: boolean;
  /** R110.13 (Barry Zhang seminar): hard wall-clock cap. Aborts the loop
   *  with a loud reason if exceeded. Default 10 min — same magnitude as
   *  the Replit Temporal subagent StartToClose. */
  maxWallClockMs?: number;
  /** R110.13: consecutive same-specialist failures before circuit-break.
   *  Echoes Barry's "after 3 repeated failures, fresh context beats more
   *  iterations" + VCA's existing 2-failed-corrections rule. Default 3. */
  maxConsecutiveSpecialistFailures?: number;
  // R110.14 — per-loop USD budget cap (Barry Zhang's iter+budget+wallclock trio).
  // Snapshots per-tenant cumulative llm_usage.cost_usd at the top of each turn
  // and aborts loudly if the run has spent more than this since `startedAt`.
  // Default = undefined (no cap, fully back-compat). Recommended values:
  //   Felix BWB pipeline: 3.00, generic supervisor: 1.00, heartbeat: 0.50
  // Cap is approximate — it counts ALL tenant LLM spend since the run started
  // (parallel runs by the same tenant inflate it). Acceptable for circuit-
  // breaker purposes; do not use as a billing meter. Fails OPEN on DB error
  // (transient DB hiccup must not kill working agents).
  maxLoopUsdBudget?: number;
  /** Actor-critic coach (2026-06-19, Bob's "Combined" mode). When the loop
   *  gets STUCK (StuckDetector flags repeated non-progress) instead of halting
   *  immediately, an independent critic LLM diagnoses the root cause, the loop
   *  bumps to a stronger model tier AND injects the critic's corrective guidance
   *  into ctx + history, then takes ONE more informed turn. Default ON. */
  criticCoachEnabled?: boolean;
  /** Max number of critic-coached recoveries per run before stuck → halt as
   *  before. Bounds the extra cost. Default 1. */
  maxCriticCoachings?: number;
}): Promise<{ runId: number; finalAnswer: string; history: SupervisorContext["history"] }> {
  const maxTurns = params.maxTurns ?? 8;
  const escalateAfterTurn = params.escalateAfterTurn ?? 3;
  const stuckEnabled = params.stuckDetectionEnabled ?? true;
  const maxWallClockMs = params.maxWallClockMs ?? 10 * 60 * 1000;
  const maxConsecutiveFailures = params.maxConsecutiveSpecialistFailures ?? 3;
  const criticCoachEnabled = params.criticCoachEnabled ?? true;
  const maxCriticCoachings = params.maxCriticCoachings ?? 1;
  let criticCoachUsed = 0;
  // Extra turn budget granted whenever a critic coaching actually fires, so the
  // promised "one more informed retry" is guaranteed to dispatch even when the
  // loop got stuck on its final allowed turn. Bounded by maxCriticCoachings.
  let coachExtraTurns = 0;
  const startedAt = Date.now();
  const consecutiveFailuresByName = new Map<string, number>();
  const { StuckDetector } = await import("./stuck-detector");
  const stuck = new StuckDetector({ window: 4, threshold: 3 });
  const run = await createRun({
    tenantId: params.tenantId,
    runType: "supervisor",
    goal: params.goal,
    state: { specialists: params.specialists.map(s => s.name), maxTurns },
    parentRunId: params.parentRunId ?? null,
  });

  const history: SupervisorContext["history"] = [];
  const log = async (msg: string, detail?: any) => {
    await appendStep(run.id, { at: new Date().toISOString(), step: msg, status: "completed", detail });
  };

  const ctx: SupervisorContext = { runId: run.id, history, log, escalationLevel: 0 };

  try {
    for (let turn = 0; turn < maxTurns + coachExtraTurns; turn++) {
      // R110.13 — wall-clock circuit breaker (Barry Zhang: every agent loop
      // needs iter + budget + wall-clock caps; loud abort beats silent stall).
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > maxWallClockMs) {
        const wallContract = renderFailureContract({
          reason: "timeout",
          failed: {
            what: "the run",
            why: `it hit the wall-clock cap (${(elapsedMs / 1000).toFixed(1)}s > ${(maxWallClockMs / 1000).toFixed(0)}s) before finishing`,
          },
          nextStep: "Re-run with a smaller scope, or split the request so each part fits the time budget.",
          nextStepOwner: "agent",
        });
        const finalAnswer = wallContract.text;
        await log(`turn:${turn}:wallclock_abort`, { elapsedMs, maxWallClockMs });
        await completeRun(run.id, { finalAnswer, failureContract: wallContract.meta, turns: turn, history, abortedReason: "wallclock_cap" });
        return { runId: run.id, finalAnswer, history };
      }

      // R110.14 — per-loop USD budget cap (Barry Zhang: iter+budget+wallclock).
      // Snapshot per-tenant llm_usage spend since `startedAt`. Fail OPEN on any
      // DB error (loud-log) — a transient query failure must not kill working
      // agents. Skipped entirely when caller did not set maxLoopUsdBudget.
      if (params.maxLoopUsdBudget !== undefined) {
        let spentUsd = 0;
        let snapshotOk = true;
        // R110.15 (architect note): explicit tenantId guard. If a caller
        // sets maxLoopUsdBudget but tenantId is undefined/0/non-positive,
        // `WHERE tenant_id = NULL` always yields 0 spend → cap silently
        // never trips, defeating the whole circuit breaker. Fail LOUD and
        // skip the snapshot rather than pretend everything is fine.
        const tid = params.tenantId;
        if (typeof tid !== "number" || !Number.isFinite(tid) || tid <= 0) {
          snapshotOk = false;
          console.error(`[executor] budget_cap configured but tenantId is invalid (${String(tid)}) — SKIPPING budget check this turn (failing OPEN)`);
        } else {
          try {
            const { db } = await import("../db");
            const { sql: sqlTpl } = await import("drizzle-orm");
            const startedIso = new Date(startedAt).toISOString();
            const r: any = await db.execute(sqlTpl`SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM llm_usage WHERE tenant_id = ${tid} AND created_at >= ${startedIso}::timestamp`);
            spentUsd = Number(((r as any).rows ?? r)?.[0]?.total || 0);
          } catch (budgetErr: any) {
            snapshotOk = false;
            console.error(`[executor] budget_cap snapshot FAILED (failing OPEN — agent continues): ${budgetErr?.message || String(budgetErr)}`);
          }
        }
        if (snapshotOk && spentUsd > params.maxLoopUsdBudget) {
          const budgetContract = renderFailureContract({
            reason: "budget_halt",
            failed: {
              what: "the run",
              why: `it hit the per-loop USD budget cap ($${spentUsd.toFixed(4)} spent > $${params.maxLoopUsdBudget.toFixed(2)} cap) before finishing`,
            },
            nextStep: "Raise the loop budget for this request, or narrow it so it completes within the cap.",
            nextStepOwner: "owner",
          });
          const finalAnswer = budgetContract.text;
          await log(`turn:${turn}:budget_abort`, { spentUsd, maxLoopUsdBudget: params.maxLoopUsdBudget, startedIso: new Date(startedAt).toISOString() });
          await completeRun(run.id, { finalAnswer, failureContract: budgetContract.meta, turns: turn, history, abortedReason: "budget_cap" });
          return { runId: run.id, finalAnswer, history };
        }
      }

      const decision = await params.router(ctx);
      await log(`turn:${turn}:decision`, decision);

      if (decision.action === "finish") {
        const finalAnswer = decision.finalAnswer ?? "Completed.";
        await completeRun(run.id, { finalAnswer, turns: turn, history });
        return { runId: run.id, finalAnswer, history };
      }

      const specialist = params.specialists.find(s => s.name === decision.specialist);
      if (!specialist) {
        throw new Error(`Supervisor chose unknown specialist: ${decision.specialist}`);
      }

      let output: any;
      // R110.13 — only TRUE specialist success (or self-heal RETRY success)
      // resets the consecutive-failure counter. Self-heal bypass (where the
      // healer returns synthetic output without re-invoking the specialist)
      // does NOT count as success; otherwise a chronically-broken specialist
      // could be papered over indefinitely and the circuit breaker would
      // never trip. (Architect MEDIUM, R110.13.)
      let dispatchSucceeded = false;
      try {
        output = await specialist.handler(decision.input, ctx);
        dispatchSucceeded = true;
      } catch (specErr: any) {
        let heal: any = { healed: false, shouldRetry: false, error: "self-heal not attempted" };
        try {
          const { attemptSelfHeal } = await import("./self-heal");
          heal = await attemptSelfHeal({
            tenantId: params.tenantId,
            runId: run.id,
            // Tag trigger source with the active escalation level so self-heal's
            // tier selector knows to start at Tier 2/3 instead of Tier 1.
            triggerSource: `supervisor:turn:${turn}:specialist:${specialist.name}:esc${ctx.escalationLevel || 0}`,
            originalGoal: params.goal,
            failure: {
              failedStep: `turn:${turn}:dispatch:${specialist.name}`,
              error: specErr?.message || String(specErr),
              errorStack: specErr?.stack?.slice(0, 1000),
              lastToolName: specialist.name,
              lastToolArgs: decision.input,
              lastToolError: specErr?.message,
              recentSteps: history.slice(-10), // R119: 3→10 (richer self-heal context)
            },
          });
        } catch (healErr: any) {
          await log(`turn:${turn}:self_heal_threw`, { error: healErr?.message || String(healErr) });
          throw specErr;
        }
        if (heal.healed && heal.shouldRetry) {
          await log(`turn:${turn}:self_healed`, { attemptId: heal.attemptId, fixType: heal.fix?.fixType });
          try {
            output = await specialist.handler(decision.input, ctx);
            dispatchSucceeded = true;
          } catch (retryErr: any) {
            throw new Error(`Specialist ${specialist.name} failed after self-heal retry: ${retryErr?.message || retryErr}`);
          }
        } else if (heal.healed) {
          output = heal.output ?? { healedBy: "self_heal", attemptId: heal.attemptId, fixType: heal.fix?.fixType };
          await log(`turn:${turn}:self_healed:bypass`, { attemptId: heal.attemptId, fixType: heal.fix?.fixType });
        } else {
          // R110.13 — track consecutive same-specialist failures and circuit-break
          // BEFORE throwing, so we surface the loop pattern instead of just the
          // last error. Echoes Barry Zhang's "fresh context beats more iterations
          // past 2-3 same-fix attempts" + VCA's 2-failed-corrections rule.
          const prior = consecutiveFailuresByName.get(specialist.name) ?? 0;
          const next = prior + 1;
          consecutiveFailuresByName.set(specialist.name, next);
          if (next >= maxConsecutiveFailures) {
            const lastError = heal.error || specErr?.message || "unknown";
            const contract = renderFailureContract({
              reason: "consecutive_failure_cap",
              failed: {
                what: `the "${specialist.name}" step`,
                why: `it failed ${next} times in a row (cap=${maxConsecutiveFailures}) and self-heal could not recover. Last error: ${lastError}`,
              },
              nextStep:
                "Re-run with a sharper, narrower instruction (fresh context beats more retries past 2-3 same-fix attempts), or split the request into smaller pieces.",
              nextStepOwner: "agent",
            });
            const finalAnswer = contract.text;
            await log(`turn:${turn}:circuit_break`, { specialist: specialist.name, consecutiveFailures: next, lastError });
            await completeRun(run.id, { finalAnswer, failureContract: contract.meta, turns: turn + 1, history, abortedReason: "consecutive_failure_cap", failedSpecialist: specialist.name });
            return { runId: run.id, finalAnswer, history };
          }
          throw new Error(`Specialist ${specialist.name} failed and self-heal could not recover: ${heal.error || specErr?.message || "unknown"}`);
        }
      }
      // R110.13 — only TRUE specialist success (handler ran and returned, OR
      // self-heal retry re-ran the handler successfully) resets the failure
      // counter. Self-heal:bypass branches do NOT reset — see comment above
      // the `dispatchSucceeded` declaration.
      if (dispatchSucceeded) consecutiveFailuresByName.set(specialist.name, 0);
      history.push({ specialist: specialist.name, input: decision.input, output });
      await log(`turn:${turn}:dispatch:${specialist.name}`, { input: decision.input, output });

      if (stuckEnabled) {
        const signal = stuck.observe(output);
        if (signal.isStuck) {
          await log(`turn:${turn}:stuck_detected`, signal);
          // Actor-critic recovery (Bob's "Combined" mode, 2026-06-19). Before
          // halting, give the loop ONE informed second chance: an INDEPENDENT
          // critic LLM reads the repeated output, diagnoses why it's stuck, we
          // bump to a stronger model tier AND inject the corrective guidance,
          // then take one more turn. Capped by maxCriticCoachings; fails OPEN
          // (any critic error → fall through to the original halt below).
          // Whole block is fail-OPEN: a module-load error, a critic failure, or
          // unusable guidance all leave `coached=false` → fall through to the
          // original halt. decideStuckRecovery is the SINGLE gate (enabled +
          // one-shot cap + escalation clamp), so there is no duplicated
          // condition that could drift out of sync.
          let coached = false;
          try {
            const { coachStuckAttempt, renderCoaching, buildCoachHistoryEntry, decideStuckRecovery } =
              await import("./critic-coach");
            const recovery = decideStuckRecovery({
              enabled: criticCoachEnabled,
              used: criticCoachUsed,
              max: maxCriticCoachings,
              escalationLevel: ctx.escalationLevel ?? 0,
            });
            if (recovery.shouldCoach) {
              const coaching = await coachStuckAttempt({
                goal: params.goal,
                stuckReason: signal.reason || "repeated non-progress output",
                lastOutput: output,
                recentHistory: history,
              });
              if (coaching.ok) {
                criticCoachUsed++;
                // Guarantee the informed retry can actually dispatch — grant one
                // extra turn so a stuck-on-the-last-turn case still gets its shot.
                coachExtraTurns++;
                // Combined: escalate to a stronger model tier alongside the
                // guidance (clamped at 2, never downgrades — see decideStuckRecovery).
                ctx.escalationLevel = recovery.nextEscalationLevel;
                ctx.criticGuidance = renderCoaching(coaching);
                // Mirror into history so history-driven routers pick it up even
                // if they don't read ctx.criticGuidance directly.
                history.push(buildCoachHistoryEntry(signal.reason, coaching));
                // Clear the stuck fingerprints so the post-coaching attempt
                // gets a clean slate (stale identical hashes would otherwise
                // re-trip the detector on the very next, possibly-different,
                // output).
                stuck.reset();
                await log(`turn:${turn}:critic_coached`, {
                  attempt: criticCoachUsed,
                  newEscalationLevel: ctx.escalationLevel,
                  rootCause: coaching.rootCause,
                  guidancePreview: coaching.guidance.slice(0, 300),
                });
                coached = true;
              }
            }
          } catch (coachErr: any) {
            await log(`turn:${turn}:critic_coach_threw`, { error: coachErr?.message || String(coachErr) });
          }
          if (coached) continue; // take one more informed turn instead of halting
          const stuckContract = renderFailureContract({
            reason: "consecutive_failure_cap",
            headline: "Stopped — the run stopped making progress",
            failed: {
              what: "the run",
              why: `it was detected as stuck (${signal.reason}). Last output: ${JSON.stringify(output).slice(0, 300)}`,
            },
            nextStep: "Re-run with a sharper, more specific instruction — fresh context beats more turns once a loop is stuck.",
            nextStepOwner: "agent",
          });
          const finalAnswer = stuckContract.text;
          await completeRun(run.id, { finalAnswer, failureContract: stuckContract.meta, turns: turn + 1, history, stuck: signal });
          return { runId: run.id, finalAnswer, history };
        }
      }
      if (turn + 1 === escalateAfterTurn && ctx.escalationLevel === 0) {
        ctx.escalationLevel = 1;
        await log(`turn:${turn}:escalation_signal`, {
          level: 1,
          message: `Reached escalation threshold (${escalateAfterTurn}). Subsequent dispatches should use a stronger model.`,
        });
      } else if (turn + 1 === escalateAfterTurn * 2 && ctx.escalationLevel === 1) {
        ctx.escalationLevel = 2;
        await log(`turn:${turn}:escalation_signal`, {
          level: 2,
          message: `Critical escalation: ${turn + 1} turns without finish. Self-heal will route to Tier 3 (Opus 4.7) on next failure.`,
        });
      }
    }

    const maxTurnsContract = renderFailureContract({
      reason: "consecutive_failure_cap",
      headline: `Stopped — reached the turn limit (${maxTurns}) without finishing`,
      failed: {
        what: "the run",
        why: `it used all ${maxTurns} allowed turns without reaching a finish. Last output: ${JSON.stringify(history[history.length - 1]?.output ?? null).slice(0, 500)}`,
      },
      nextStep: "Re-run with a narrower goal, or break the request into smaller steps so each completes within the turn budget.",
      nextStepOwner: "agent",
    });
    const finalAnswer = maxTurnsContract.text;
    await completeRun(run.id, { finalAnswer, failureContract: maxTurnsContract.meta, turns: maxTurns, history, truncated: true });
    return { runId: run.id, finalAnswer, history };
  } catch (err: any) {
    await failRun(run.id, err?.message || String(err));
    throw err;
  }
}

/**
 * Retry with exponential backoff — for flaky external APIs.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; onRetry?: (attempt: number, err: any) => void } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      opts.onRetry?.(attempt, err);
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}
