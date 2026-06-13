/**
 * escalation-resolver.ts — R125+49
 *
 * Drives the BACKLOG of stuck repair_incidents to a terminal state. The
 * self-repair loop (repair-incident.ts) captures + classifies + dispatches a
 * remedy, but a large class of incidents never reaches `resolved=true`:
 *
 *   · escalated=true (jury/heuristic put it in front of the owner) — nothing
 *     ever re-examines it, so it sits open forever.
 *   · action_outcome ∈ {rate_limited, no_fix_proposed, awaiting_hitl,
 *     autofix_disabled, dispatch_error} — the surgeon couldn't safely close it
 *     and there is no sweep that retries.
 *
 * Bob's request (2026-06-08): "I want Felix in the agents as well as the jury
 * look at all that stuff so we can either accept them, reject them, fix them —
 * do whatever — so all that stuff that needs to be looked at gets looked at and
 * taken care of either way." Safety judgment delegated to the jury: "if it's a
 * risky setup then reject it — that's what the jury system is supposed to do."
 *
 * This resolver REUSES the existing decision + safety machinery rather than
 * re-implementing (or weakening) any of it:
 *
 *   1. juryTriage  — fresh 3-frontier-model vote on the incident.
 *   2. mapJuryDecision + enforceSafetyRouting — the SAME pure brain the live
 *      classifier uses. A guard firing correctly / a fix that would touch a
 *      test|guard|safety surface is forced AWAY from auto-fix; a non-unanimous
 *      or low-fix-concordance FIX escalates instead of guessing.
 *   3. Routing → action:
 *        · 'surface'        (ACCEPT/REJECT majority, or guard-working-as-intended)
 *                           → CLOSE the incident (ledger-only, fully reversible).
 *        · 'repo_surgeon'   (UNANIMOUS, safe-surface FIX) → dispatchIncidentRemedy,
 *                           inheriting REPAIR_AUTOFIX_ENABLED + repo-surgeon's
 *                           typecheck/rollback/guard-invariant/HITL gates. DEV
 *                           ONLY (prod FS is ephemeral) — in prod it is KEPT.
 *        · 'escalate_owner' (jury could neither clear nor confirm) → Felix, the
 *                           CEO persona, gives a FINAL non-destructive call:
 *                           ACCEPT/REJECT closes it; KEEP leaves it for a human.
 *
 * Safety invariants (Bob delegated the call to the jury + the existing gates):
 *   · Code is ONLY ever modified via the jury-UNANIMOUS-FIX → repo_surgeon path,
 *     which is itself opt-in (REPAIR_AUTOFIX_ENABLED) and self-verifies.
 *   · ACCEPT/REJECT close only the ledger record — zero code/prod mutation,
 *     reversible, fully recorded (votes + rationale + decidedBy).
 *   · Felix can ONLY accept/reject/keep — it can NEVER trigger a code change.
 *   · Bounded per run (MAX_PER_RUN) so a 200-deep backlog drains gradually, not
 *     in one burst of jury-cost calls (the thundering-herd lesson from the
 *     jury-queue drainer). Oldest stuck first. Items Felix already KEPT for a
 *     human are skipped for `recheckDays` so we don't re-spend on them.
 *
 * NEVER throws — telemetry/self-repair must not break its caller.
 */

import {
  type RawIncident,
  type DispatchArgs,
  type LedgerActionPatch,
  mapJuryDecision,
  enforceSafetyRouting,
  dispatchIncidentRemedy,
  updateIncidentAction,
} from "./repair-incident";
import type { JuryDecision } from "../lib/jury-triage";
import { logSilentCatch } from "../lib/silent-catch";
import { checkAutonomousBudget, claimAutonomousBudget } from "./autonomous-budget";

// Stuck-but-open outcomes the surgeon/dispatcher left without a terminal close.
export const STUCK_OUTCOMES = [
  "rate_limited",
  "no_fix_proposed",
  "awaiting_hitl",
  "autofix_disabled",
  "dispatch_error",
] as const;

// The terminal-close outcome we write on a resolved incident, and the
// non-terminal "a human still needs to look" outcome (skipped on re-sweep).
const OUTCOME_ACCEPTED = "accepted";
const OUTCOME_REJECTED = "rejected";
const OUTCOME_KEPT = "jury_kept_for_human";

export type FelixDecision = "ACCEPT" | "REJECT" | "KEEP";
export interface FelixReview {
  decision: FelixDecision;
  rationale: string;
}

/** A stuck incident row (raw snake_case from the parameterized SELECT). */
export interface StuckRow {
  id: number;
  tenant_id: number;
  source: string;
  title: string | null;
  signature: string | null;
  detail: any;
  classification: string | null;
  routed_to: string | null;
  action_outcome: string | null;
  escalated: boolean;
  safety_blocked_autofix: boolean;
}

export interface ResolverOptions {
  tenantId?: number;
  maxPerRun?: number;
  recheckDays?: number;
  dryRun?: boolean;
  /** Explicit opt-in to act for real. When neither this nor dryRun is set, the
   *  resolver defaults to dryRun=true (safe-by-default) unless ESCALATION_RESOLVER_LIVE=true. */
  live?: boolean;
  /** Override the daily autonomous-spend cap (USD) for this run. */
  dailyBudgetUsd?: number;
}

export interface ResolverDeps {
  fetchStuck?: (tenantId: number, max: number, recheckDays: number, now: number) => Promise<StuckRow[]>;
  runJury?: (raw: RawIncident) => Promise<JuryDecision>;
  consultFelix?: (raw: RawIncident, jury: JuryDecision, tenantId: number) => Promise<FelixReview>;
  dispatch?: (args: DispatchArgs) => Promise<void>;
  updateLedger?: (incidentId: number, tenantId: number, patch: LedgerActionPatch) => Promise<boolean>;
  emitEvent?: (e: { type: string; source: string; tenantId: number; data?: any }) => Promise<any>;
  isProd?: () => boolean;
  now?: () => number;
  /** Autonomous-spend governor. Returns ok:false when the day's cap is hit. */
  checkBudget?: (tenantId: number, capUsd?: number) => Promise<{ ok: boolean; spentUsd: number; capUsd: number; degraded: boolean; reason: string }>;
  /** Atomic claim-before-spend for the TOP gate (reserves this run's estimate so
   *  two concurrent autonomous loops can't both pass a read-only check). Mid-run
   *  re-checks stay reads (checkBudget) — claiming again would double-reserve. */
  claimBudget?: (tenantId: number, estimatedUsd: number, capUsd?: number) => Promise<{ ok: boolean; spentUsd: number; capUsd: number; degraded: boolean; reason: string }>;
}

export interface ResolverItem {
  incidentId: number;
  outcome: string;
  decidedBy: "jury" | "felix" | "repo_surgeon";
  juryVerdict?: string;
}

export interface ResolverResult {
  ran: boolean;
  skippedReason?: string;
  considered: number;
  closedAccepted: number;
  closedRejected: number;
  dispatchedFix: number;
  keptForHuman: number;
  errors: number;
  dryRun: boolean;
  items: ResolverItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (no IO — unit-testable)
// ─────────────────────────────────────────────────────────────────────────────

/** Rebuild the RawIncident the classifier needs from a persisted ledger row. */
export function reconstructRawIncident(row: StuckRow): RawIncident {
  const d = (row.detail || {}) as any;
  return {
    tenantId: row.tenant_id,
    source: row.source as any,
    title: row.title || undefined,
    signature: row.signature || undefined,
    error: d.error || undefined,
    errorStack: d.errorStack || undefined,
    logs: d.logs || undefined,
    stage: d.stage || undefined,
    candidateFiles: Array.isArray(d.candidateFiles) ? d.candidateFiles : undefined,
    lastToolName: d.lastToolName || undefined,
    lastToolArgs: d.lastToolArgs,
    lastToolError: d.lastToolError || undefined,
    lastToolRiskClass: d.lastToolRiskClass || undefined,
    felixFailureKind: d.felixFailureKind || undefined,
    ciRuleId: d.ciRuleId || undefined,
    metadata: d.metadata,
  };
}

/** Parse Felix's structured review. Any malformed/unknown output → KEEP (the
 *  conservative choice: never auto-close a human-grade incident on a parse
 *  failure). Exported for unit coverage. */
export function parseFelixReview(text: string): FelixReview {
  const fallback: FelixReview = { decision: "KEEP", rationale: "(unparseable Felix review — kept for human)" };
  if (!text || !text.trim()) return fallback;
  try {
    // Tolerate a fenced/﻿prefixed JSON object.
    const m = text.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : text);
    const raw = String(obj.decision || obj.verdict || "").trim().toUpperCase();
    const decision: FelixDecision =
      raw === "ACCEPT" ? "ACCEPT" : raw === "REJECT" ? "REJECT" : raw === "KEEP" ? "KEEP" : "KEEP";
    return { decision, rationale: String(obj.rationale || obj.reason || "").slice(0, 1200) };
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default IO seams
// ─────────────────────────────────────────────────────────────────────────────

async function defaultFetchStuck(
  tenantId: number,
  max: number,
  recheckDays: number,
  now: number,
): Promise<StuckRow[]> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  // text[] literal for ANY() — these are fixed constants (never user input);
  // built per the house "no raw JS array into a sql template" rule.
  const stuckLiteral = `{${STUCK_OUTCOMES.map((s) => `"${s}"`).join(",")}}`;
  const cutoff = new Date(now - recheckDays * 86_400_000);
  const res: any = await db.execute(sql`
    SELECT id, tenant_id, source, title, signature, detail, classification,
           routed_to, action_outcome, escalated, safety_blocked_autofix
    FROM repair_incidents
    WHERE tenant_id = ${tenantId}
      AND resolved = false
      AND (escalated = true OR action_outcome = ANY(${stuckLiteral}::text[]))
      AND NOT (action_outcome = ${OUTCOME_KEPT}
               AND dispatched_at IS NOT NULL
               AND dispatched_at > ${cutoff})
    ORDER BY created_at ASC
    LIMIT ${max}
  `);
  return ((res as any).rows || res || []) as StuckRow[];
}

async function defaultRunJury(raw: RawIncident): Promise<JuryDecision> {
  const { juryTriage } = await import("../lib/jury-triage");
  const issueText = [
    `A self-repair incident from source "${raw.source}" is OPEN and stuck — it was escalated or could not be safely auto-closed, and a human has not resolved it.`,
    `Decide: is this a GENUINE CODE DEFECT warranting an automated code fix (FIX), a non-actionable / expected / acceptable condition (ACCEPT), or a false alarm / non-issue (REJECT)?`,
    `If it represents a RISKY setup or anything unsafe to auto-fix, REJECT it. NEVER recommend changing a test, guard, or safety profile to make a failure pass.`,
    ``,
    `Title: ${(raw.title || "(none)").slice(0, 300)}`,
    `Stage: ${raw.stage || "(unknown)"}`,
    `Error: ${(raw.error || "(none)").slice(0, 1500)}`,
    raw.lastToolName ? `Last tool: ${raw.lastToolName} (risk ${raw.lastToolRiskClass || "?"})` : "",
    raw.candidateFiles?.length ? `Candidate files: ${raw.candidateFiles.slice(0, 20).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return juryTriage({
    issueText,
    context: (raw.logs || raw.errorStack || "").slice(0, 2000),
    tenantId: raw.tenantId,
    invokedVia: "escalation-resolver",
  });
}

const FELIX_REVIEWER_SYSTEM =
  `You are Felix, the CEO of VisionClaw Corporation, acting as the FINAL reviewer of a self-repair incident that the model jury could not decisively clear or confirm. ` +
  `Your ONLY job here is a non-destructive disposition. You CANNOT and MUST NOT request, design, or approve any code change — genuine code fixes are handled separately by a guarded auto-fixer and are out of scope for you. ` +
  `Choose exactly one:\n` +
  `  ACCEPT = this is an expected / known / acceptable condition; close it as documented (no action needed).\n` +
  `  REJECT = this is a false alarm or a non-issue (or a risky setup that should NOT be acted on); close it.\n` +
  `  KEEP   = it genuinely needs a human engineer's eyes (it might need a real code change, or you are unsure). When in doubt, choose KEEP.\n` +
  `Respond with ONLY a JSON object: {"decision":"ACCEPT|REJECT|KEEP","rationale":"<=3 sentences"}. No markdown, no preamble.`;

async function defaultConsultFelix(raw: RawIncident, jury: JuryDecision, tenantId: number): Promise<FelixReview> {
  try {
    const { getClientForModel, getModelForTierAsync } = await import("../providers");
    const modelId = await getModelForTierAsync("powerful", tenantId);
    const { client, actualModelId } = await getClientForModel(modelId, tenantId);
    const voteLines = (jury.votes || [])
      .map((v) => `- ${v.model}: ${v.verdict} — ${(v.rationale || "").slice(0, 200)}`)
      .join("\n");
    const user =
      `INCIDENT\n` +
      `Title: ${(raw.title || "(none)").slice(0, 300)}\n` +
      `Source: ${raw.source}\n` +
      `Stage: ${raw.stage || "(unknown)"}\n` +
      `Error: ${(raw.error || "(none)").slice(0, 1200)}\n` +
      (raw.candidateFiles?.length ? `Candidate files: ${raw.candidateFiles.slice(0, 12).join(", ")}\n` : "") +
      `\nJURY (could not decide): verdict=${jury.verdict} majority=${jury.majority}\n${voteLines}\n` +
      `\nGive your final disposition as JSON.`;
    const resp: any = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: FELIX_REVIEWER_SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" } as any,
    });
    const txt = resp?.choices?.[0]?.message?.content || "";
    try {
      const { recordCost } = await import("./cost-ledger");
      await recordCost({
        tenantId,
        toolName: "escalation_resolver_felix",
        model: actualModelId,
        tokensIn: resp?.usage?.prompt_tokens,
        tokensOut: resp?.usage?.completion_tokens,
        operation: "felix_incident_review",
        personaId: 2,
      });
    } catch (_e) { logSilentCatch("server/agentic/escalation-resolver.ts", _e); }
    return parseFelixReview(txt);
  } catch (e: any) {
    return {
      decision: "KEEP",
      rationale: `Felix consult error (kept for human): ${String(e?.message || e).slice(0, 200)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveEscalationBacklog(
  opts: ResolverOptions = {},
  deps: ResolverDeps = {},
): Promise<ResolverResult> {
  const tenantId = opts.tenantId ?? 1;
  const maxPerRun = Math.max(1, opts.maxPerRun ?? (parseInt(process.env.ESCALATION_RESOLVER_MAX_PER_RUN || "5", 10) || 5));
  const recheckDays = Math.max(0, opts.recheckDays ?? (parseInt(process.env.ESCALATION_RESOLVER_RECHECK_DAYS || "7", 10) || 7));
  // SAFE-BY-DEFAULT: the resolver only acts for real when explicitly told to
  // (opts.live / opts.dryRun=false / ESCALATION_RESOLVER_LIVE=true). A bare run
  // — e.g. a workflow the platform auto-starts on boot — defaults to dryRun so it
  // can never silently drive incidents to terminal states or spend on its own.
  const live = opts.live ?? (process.env.ESCALATION_RESOLVER_LIVE === "true");
  const dryRun = opts.dryRun ?? !live;
  const now = deps.now ?? (() => Date.now());

  const fetchStuck = deps.fetchStuck ?? defaultFetchStuck;
  const runJury = deps.runJury ?? defaultRunJury;
  const consultFelix = deps.consultFelix ?? defaultConsultFelix;
  const dispatch = deps.dispatch ?? dispatchIncidentRemedy;
  const updateLedger = deps.updateLedger ?? updateIncidentAction;
  const isProd =
    deps.isProd ?? (() => process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production");
  const checkBudget =
    deps.checkBudget ??
    ((tid: number, cap?: number) =>
      checkAutonomousBudget({ tenantId: tid, capUsd: cap, label: "escalation-resolver" }));
  const claimBudget =
    deps.claimBudget ??
    ((tid: number, est: number, cap?: number) =>
      claimAutonomousBudget({ tenantId: tid, estimatedUsd: est, capUsd: cap, label: "escalation-resolver" }));

  const result: ResolverResult = {
    ran: true,
    considered: 0,
    closedAccepted: 0,
    closedRejected: 0,
    dispatchedFix: 0,
    keptForHuman: 0,
    errors: 0,
    dryRun,
    items: [],
  };

  if (process.env.ESCALATION_RESOLVER_DISABLED === "true") {
    return { ...result, ran: false, skippedReason: "kill_switch (ESCALATION_RESOLVER_DISABLED=true)" };
  }

  // Cheap read FIRST (a DB query, not a spend): if there's no stuck backlog, there
  // is no paid work to do — return without reserving any budget so an idle poll
  // never orphans a claim that would create false budget pressure on the cap.
  let rows: StuckRow[];
  try {
    rows = await fetchStuck(tenantId, maxPerRun, recheckDays, now());
  } catch (e: any) {
    return { ...result, ran: false, skippedReason: `fetch_failed: ${String(e?.message || e).slice(0, 200)}` };
  }

  result.considered = rows.length;
  if (rows.length === 0) return result;

  // Autonomous-spend governor — paid work is now CERTAIN (even a dryRun preview
  // calls the MoA jury per incident = real spend), so reserve here. Atomic
  // claim-before-spend: reserve an estimate sized to the actual backlog (≈ one jury
  // call per incident to process) under a per-tenant lock so a second autonomous
  // loop starting concurrently can't also read "under budget" and double-spend.
  // The reservation ages out (TTL) once the real jury spend lands in the ledger.
  // ok:false ⇒ refuse to start; a claim we can't complete fails CLOSED by default
  // (operators opt into fail-open via AUTONOMOUS_BUDGET_FAILOPEN=true).
  const budget = await claimBudget(tenantId, Math.max(1, rows.length), opts.dailyBudgetUsd);
  if (!budget.ok) {
    return {
      ...result,
      ran: false,
      skippedReason: `budget_cap: today's autonomous spend $${budget.spentUsd.toFixed(2)} >= cap $${budget.capUsd.toFixed(2)}`,
    };
  }

  let processed = 0;
  for (const row of rows) {
    // Hard ceiling at incident granularity: this run's own jury spend is recorded
    // to the ledger as it goes, so re-check before EACH subsequent incident and
    // stop the moment the cap is crossed — a single admitted run can no longer
    // overrun by up to maxPerRun incidents. (First incident already passed the
    // pre-run gate above, so skip the redundant re-query for it.)
    if (processed > 0) {
      const midRun = await checkBudget(tenantId, opts.dailyBudgetUsd);
      if (!midRun.ok) {
        result.skippedReason = `budget_cap_midrun: stopped after ${processed}/${rows.length} (spent $${midRun.spentUsd.toFixed(2)} >= cap $${midRun.capUsd.toFixed(2)})`;
        break;
      }
    }
    processed++;
    try {
      const raw = reconstructRawIncident(row);
      const jury = await runJury(raw);
      // The SAME pure brain the live classifier uses — guard/protected surfaces
      // are forced away from auto-fix; split / low-concordance FIX escalates.
      const decision = enforceSafetyRouting(raw, mapJuryDecision(jury));
      const recentChanges: string[] = Array.isArray((row.detail || {}).recentChanges)
        ? (row.detail as any).recentChanges
        : [];

      if (decision.routedTo === "surface") {
        // Jury ACCEPT/REJECT majority, or a guard firing correctly (working as
        // intended). Close the ledger record — never touches code.
        const reject = jury.verdict === "REJECT";
        const outcome = reject ? OUTCOME_REJECTED : OUTCOME_ACCEPTED;
        if (!dryRun) {
          await updateLedger(row.id, tenantId, {
            actionTaken: "jury_resolve",
            actionOutcome: outcome,
            actionDetail: {
              decidedBy: "jury",
              juryVerdict: jury.verdict,
              majority: jury.majority,
              reason: decision.reason.slice(0, 600),
              votes: (jury.votes || []).map((v) => ({ model: v.model, verdict: v.verdict })),
            },
            resolved: true,
          });
        }
        if (reject) result.closedRejected++;
        else result.closedAccepted++;
        result.items.push({ incidentId: row.id, outcome, decidedBy: "jury", juryVerdict: jury.verdict });
        continue;
      }

      if (decision.routedTo === "repo_surgeon") {
        // Unanimous, safe-surface FIX. File edits are pointless/harmful on the
        // ephemeral prod FS, so in prod we KEEP it for a human (mirrors the
        // autonomous-closer prod refusal). In dev, hand to the guarded surgeon
        // — it inherits REPAIR_AUTOFIX_ENABLED + typecheck/rollback/HITL and
        // sets resolved/escalated on the row itself.
        if (isProd()) {
          if (!dryRun) {
            await updateLedger(row.id, tenantId, {
              actionTaken: "escalation_review",
              actionOutcome: OUTCOME_KEPT,
              actionDetail: { decidedBy: "jury", note: "unanimous FIX but prod runtime — code fix deferred to a human (dev-only).", juryVerdict: jury.verdict },
              escalated: true,
            });
          }
          result.keptForHuman++;
          result.items.push({ incidentId: row.id, outcome: OUTCOME_KEPT, decidedBy: "jury", juryVerdict: jury.verdict });
          continue;
        }
        if (!dryRun) {
          await dispatch({
            incidentId: row.id,
            tenantId,
            routedTo: "repo_surgeon",
            classification: decision.classification,
            enriched: raw,
            recentChanges,
          });
        }
        result.dispatchedFix++;
        result.items.push({ incidentId: row.id, outcome: "dispatched_repo_surgeon", decidedBy: "repo_surgeon", juryVerdict: jury.verdict });
        continue;
      }

      // escalate_owner — the jury could neither clear nor confirm. Felix gives a
      // FINAL non-destructive call so it does not just pile on the owner.
      const felix = await consultFelix(raw, jury, tenantId);
      if (felix.decision === "ACCEPT" || felix.decision === "REJECT") {
        const outcome = felix.decision === "REJECT" ? OUTCOME_REJECTED : OUTCOME_ACCEPTED;
        if (!dryRun) {
          await updateLedger(row.id, tenantId, {
            actionTaken: "felix_resolve",
            actionOutcome: outcome,
            actionDetail: {
              decidedBy: "felix",
              felixDecision: felix.decision,
              felixRationale: felix.rationale.slice(0, 800),
              juryVerdict: jury.verdict,
              juryReason: decision.reason.slice(0, 400),
            },
            resolved: true,
          });
        }
        if (felix.decision === "REJECT") result.closedRejected++;
        else result.closedAccepted++;
        result.items.push({ incidentId: row.id, outcome, decidedBy: "felix", juryVerdict: jury.verdict });
        continue;
      }

      // Felix KEEP (or consult error) — genuine human-grade incident. Stamp it
      // so the next sweep skips it for `recheckDays` (no re-spend).
      if (!dryRun) {
        await updateLedger(row.id, tenantId, {
          actionTaken: "escalation_review",
          actionOutcome: OUTCOME_KEPT,
          actionDetail: {
            decidedBy: "felix",
            felixDecision: "KEEP",
            felixRationale: felix.rationale.slice(0, 800),
            juryVerdict: jury.verdict,
          },
          escalated: true,
        });
      }
      result.keptForHuman++;
      result.items.push({ incidentId: row.id, outcome: OUTCOME_KEPT, decidedBy: "felix", juryVerdict: jury.verdict });
    } catch (e: any) {
      result.errors++;
      console.error(`[escalation-resolver] incident #${row?.id} failed (non-fatal): ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  // One consolidated owner digest per run (never per-item spam). Best-effort.
  const acted = result.closedAccepted + result.closedRejected + result.dispatchedFix + result.keptForHuman;
  if (!dryRun && acted > 0) {
    try {
      const emit = deps.emitEvent ?? (await import("../event-bus")).emitEvent;
      await emit({
        type: "repair.escalation.swept",
        source: "escalation-resolver",
        tenantId,
        data: {
          considered: result.considered,
          closedAccepted: result.closedAccepted,
          closedRejected: result.closedRejected,
          dispatchedFix: result.dispatchedFix,
          keptForHuman: result.keptForHuman,
          errors: result.errors,
          keptIncidentIds: result.items.filter((i) => i.outcome === OUTCOME_KEPT).map((i) => i.incidentId),
          ledgerLink: "/admin/repair-ledger",
        },
      });
    } catch (e: any) {
      console.warn(`[escalation-resolver] digest emit failed (non-fatal): ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  return result;
}
