// ─────────────────────────────────────────────────────────────────────────────
// R125+52.41 (Bob 2026-06-16) — Agent-engageable SECOND OPINION via OpenRouter
// Fusion (`openrouter/fusion`: a managed panel of frontier models that answer in
// parallel → a judge compares → a final model synthesizes, with built-in web
// search). Two entry points share this one core:
//
//   1. ON-DEMAND  — the `second_opinion` agent tool (server/tools.ts). Any of the
//      16 personas can call it when their own answer feels shaky / high-stakes and
//      they want an INDEPENDENT, lineage-diverse external cross-check before
//      committing or bugging the human.
//   2. AUTO       — server/moa.ts calls this when our native ensemble comes back
//      low-confidence (shouldEscalate: κ < 0.5 or single-proposer). The Fusion
//      cross-check rides along in the MoAResult so a low-κ answer already carries
//      an outside opinion before anything escalates to a human.
//
// Guardrails (Bob chose "Auto + on-demand" with a HARD $25/day Fusion cap):
//   • METERED. Real OpenRouter spend per call (usage.cost) recorded to the ledger
//     under toolName "second_opinion" (on-demand) / "second_opinion_auto" (auto).
//   • DEDICATED $25/day Fusion budget (FUSION_DAILY_BUDGET_USD), summed from the
//     ledger on those exact toolNames. ATOMIC RESERVE-THEN-SETTLE: each call
//     reserves an estimate row under a per-tenant advisory xact lock BEFORE
//     spending (so concurrent low-κ auto-calls can't all pass a stale read and
//     overshoot the HARD cap), then settles that same row in place to the real
//     usage.cost. Fails CLOSED on a reserve/ledger error (can't prove we're under
//     cap ⇒ don't spend), with a loud FUSION_BUDGET_FAILOPEN=true opt-out. Owner
//     tenant only by default; other tenants need a provisioned budget (never spend
//     the owner's money on them).
//   • FAIL-OPEN on quality: getSecondOpinion NEVER throws. A failure / skip
//     returns { ok:false, ... } so the caller (chat turn, ensemble) is never
//     broken by the cross-check — the worst case is "no second opinion", never a
//     crashed turn.
//   • NO RECURSION: this calls the Fusion provider lane DIRECTLY (getClientForModel),
//     never executeMoA — so the moa.ts auto-hook can't loop.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./db";
import { sql } from "drizzle-orm";
import { getClientForModel } from "./providers";
import { ownerTenantId } from "./agentic/autonomous-budget";
import { logSilentCatch } from "./lib/silent-catch";

export const FUSION_MODEL_ID = (process.env.FUSION_MODEL || "openrouter/fusion").trim();
export const FUSION_DAILY_BUDGET_USD = (() => {
  const n = parseFloat(process.env.FUSION_DAILY_BUDGET_USD || "");
  return Number.isFinite(n) && n > 0 ? n : 25;
})();

// Hard per-call input/output CEILINGS. Without an output cap a single Fusion
// synthesis can generate effectively unboundedly, and `question` is otherwise
// unbounded (only a ≥10-char MIN is checked), so one call's real usage.cost
// could exceed any fixed reservation. Capping the output tokens AND truncating
// the question input makes the per-call cost BOUNDED, which in turn lets us
// derive a deterministic worst-case dollar bound below.
// Override via FUSION_MAX_OUTPUT_TOKENS / FUSION_MAX_QUESTION_CHARS.
export const FUSION_MAX_OUTPUT_TOKENS = (() => {
  const n = parseInt(process.env.FUSION_MAX_OUTPUT_TOKENS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 4096;
})();
export const FUSION_MAX_QUESTION_CHARS = (() => {
  const n = parseInt(process.env.FUSION_MAX_QUESTION_CHARS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 16000;
})();

// Deterministic WORST-CASE per-call cost, DERIVED from the hard ceilings above.
// This is the keystone of the hard-cap guarantee: under-reserving is the ONLY
// way concurrent reserve-then-settle can breach the daily cap, whereas
// OVER-reserving is always cap-safe (settle rewrites the reservation row down
// to the real, lower usage.cost the moment the call returns). So we reserve
// against a pessimistic upper bound, never a hopeful average.
//   - Fusion bills a panel→judge→synthesis pipeline, so usage.cost is a MULTIPLE
//     of a single completion → FUSION_PIPELINE_STAGE_MULTIPLIER pads for that.
//   - Rates are conservative premium-frontier ($/1K tokens); chars/token is
//     deliberately LOW so the token estimate runs HIGH.
// These constants are intentionally pessimistic — the goal is a SAFE budgeting
// ceiling, not an accurate price (the real cost is captured at settle time).
const FUSION_WORST_CASE_INPUT_PER_1K_USD = 0.005; // $5 / 1M input tokens
const FUSION_WORST_CASE_OUTPUT_PER_1K_USD = 0.015; // $15 / 1M output tokens
const FUSION_PIPELINE_STAGE_MULTIPLIER = 10; // panel (≤~5) + judge + synthesis, padded
const FUSION_CHARS_PER_TOKEN = 3; // pessimistic (fewer chars/token ⇒ more tokens ⇒ higher estimate)
export const FUSION_WORST_CASE_USD = (() => {
  const inputChars = FUSION_MAX_QUESTION_CHARS + 12_000 /* draft cap */ + 4_000 /* system+labels pad */;
  const inputTokens = inputChars / FUSION_CHARS_PER_TOKEN;
  const outputTokens = FUSION_MAX_OUTPUT_TOKENS;
  const perStageUsd =
    (inputTokens / 1000) * FUSION_WORST_CASE_INPUT_PER_1K_USD +
    (outputTokens / 1000) * FUSION_WORST_CASE_OUTPUT_PER_1K_USD;
  return perStageUsd * FUSION_PIPELINE_STAGE_MULTIPLIER;
})();

// Per-call reservation amount. Reserved against the cap BEFORE the paid call so
// concurrent low-κ ensembles can't all pass a read-only "under cap" check and
// overshoot the HARD daily cap; the reservation row is then settled in place to
// the real usage.cost. CLAMPED UP to FUSION_WORST_CASE_USD: an operator-set
// FUSION_CALL_ESTIMATE_USD below the derived worst-case would silently reopen
// the overshoot path, so we never reserve less than the bound. Setting it HIGHER
// is allowed (more conservative). Override via FUSION_CALL_ESTIMATE_USD.
export const FUSION_CALL_ESTIMATE_USD = (() => {
  const n = parseFloat(process.env.FUSION_CALL_ESTIMATE_USD || "");
  const configured = Number.isFinite(n) && n > 0 ? n : 0.5;
  return Math.max(configured, FUSION_WORST_CASE_USD);
})();

// Hard deadlines (ms). Fusion's panel→judge→synthesis is genuinely slow, so the
// ON-DEMAND tool tolerates a longer wait; the AUTO hook in moa.ts passes the
// tighter FUSION_AUTO_TIMEOUT_MS so a low-κ ensemble is NEVER delayed
// unboundedly. Both fail OPEN on timeout (worst case: no second opinion, never a
// stalled turn). Override via FUSION_TIMEOUT_MS / FUSION_AUTO_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.FUSION_TIMEOUT_MS || "", 10);
  // Trimmed 90s → 60s: Fusion almost never lands a USEFUL answer between 60s and
  // 90s, so the extra 30s was pure dead-wait before the fail-open kicks in.
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();
export const FUSION_AUTO_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.FUSION_AUTO_TIMEOUT_MS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
})();

export type SecondOpinionAgreement = "agree" | "partial" | "disagree" | "unknown";

export interface SecondOpinionResult {
  /** true ⇒ Fusion answered and the answer is in `answer`. */
  ok: boolean;
  /** Fusion's independent answer (+ its agreement assessment of any draft). */
  answer?: string;
  /** Parsed verdict on the caller's draft_answer (only meaningful if a draft was passed). */
  agreement?: SecondOpinionAgreement;
  /** The resolved provider model id actually used. */
  model?: string;
  /** Real OpenRouter spend for this call in USD (null when usage.cost is absent). */
  costUsd?: number | null;
  latencyMs?: number;
  /** Present whenever we short-circuited without (or before) spending. */
  skipped?: "budget" | "invalid" | "wiring" | "error" | "latched";
  error?: string;
  /** Dedicated Fusion daily-budget snapshot at decision time. */
  budget?: { spentUsd: number; capUsd: number; remainingUsd: number; degraded: boolean };
}

export interface GetSecondOpinionOpts {
  /** Self-contained question or claim to cross-check (Fusion sees ONLY this + draft). */
  question: string;
  /** Optional but recommended: the caller's current answer, so Fusion assesses agree/partial/disagree. */
  draftAnswer?: string;
  tenantId: number;
  invokedVia?: string;
  /** Free-text reason (e.g. "low-concordance κ=0.31") for telemetry. */
  reason?: string;
  /** true ⇒ fired by the moa.ts auto-hook (records under second_opinion_auto). */
  auto?: boolean;
  /** Hard deadline for the Fusion call (ms). Defaults to FUSION_TIMEOUT_MS; the auto-hook passes FUSION_AUTO_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Explicit owner override to bypass a tripped cost-drift latch (deliberate human action). */
  ownerOverride?: boolean;
}

/**
 * Whether the AUTO second-opinion hook in moa.ts is enabled. Bob chose "auto +
 * on-demand", so this defaults ON; FUSION_AUTO_SECOND_OPINION=false (or 0/no/off)
 * turns OFF only the automatic low-confidence trigger — the on-demand tool is
 * unaffected.
 */
export function fusionAutoEnabled(): boolean {
  if (autoSpendLatchTripped) return false; // drift tripwire — fail CLOSED on the AUTO path
  const v = (process.env.FUSION_AUTO_SECOND_OPINION || "").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

// ── Fail-closed cost-drift tripwire ───────────────────────────────────────────
// FUSION_WORST_CASE_USD is a HEURISTIC bound (conservative rates × stage
// multiplier over the hard token/char ceilings). If real OpenRouter billing ever
// drifts ABOVE it — a pricing change, a wider internal fan-out, hidden tooling
// tokens — the reservation would UNDER-estimate, and concurrent reserve-then-
// settle could overshoot the HARD daily cap. So the settle path verifies the
// heuristic against the REAL usage.cost on EVERY call (provider-anchored ground
// truth): the first time an actual cost exceeds what we reserved, this latch
// trips, disabling BOTH the AUTOMATIC low-κ trigger AND the on-demand spend path
// (getSecondOpinion fails closed with skipped:"latched" unless the caller passes
// an explicit ownerOverride) and paging the owner — bounding a single drift
// overshoot instead of letting it silently repeat. Resets on process restart (the
// daily cap also resets); stays tripped for the process lifetime until raised.
let autoSpendLatchTripped = false;
let autoSpendLatchReason = "";

/** Whether the fail-closed cost-drift latch is currently tripped. */
export function fusionAutoLatchTripped(): boolean {
  return autoSpendLatchTripped;
}

/** Human-readable reason the latch tripped (empty when untripped). */
export function fusionAutoLatchReason(): string {
  return autoSpendLatchReason;
}

/** Test-only: clear the in-memory drift latch. */
export function __resetFusionAutoLatch(): void {
  autoSpendLatchTripped = false;
  autoSpendLatchReason = "";
}

/**
 * Trip the fail-closed cost-drift latch. Idempotent (only the first call trips).
 * NEVER throws — the owner page is best-effort fire-and-forget so it can be
 * called safely from the NEVER-throws settle path. Returns true iff this call
 * was the one that tripped it.
 */
export function tripFusionAutoLatch(detail: {
  reservedUsd: number;
  realCostUsd: number;
  tenantId: number;
  operation: string;
}): boolean {
  if (autoSpendLatchTripped) return false;
  autoSpendLatchTripped = true;
  autoSpendLatchReason = `real cost $${detail.realCostUsd.toFixed(4)} exceeded reserved $${detail.reservedUsd.toFixed(4)}`;
  console.error(
    `[second-opinion] COST-DRIFT LATCH TRIPPED — ${autoSpendLatchReason} ` +
      `(tenant=${detail.tenantId} op=${detail.operation}). AUTO Fusion second-opinion DISABLED ` +
      `for this process until the FUSION_CALL_ESTIMATE_USD floor is raised.`,
  );
  // Best-effort owner page — fire-and-forget, never blocks or poisons settle.
  void (async () => {
    try {
      const { sendEmailDirect, isEmailConfigured } = await import("./email");
      const { resolveOwnerEmail } = await import("./lib/owner-email");
      const to = resolveOwnerEmail();
      if (!to || !isEmailConfigured()) return;
      await sendEmailDirect({
        to,
        subject: "⚠️ Fusion second-opinion cost-drift latch tripped (AUTO spend disabled)",
        text:
          `A Fusion (second_opinion) call billed MORE than its reserved estimate, meaning the worst-case ` +
          `heuristic (FUSION_WORST_CASE_USD) under-estimated real cost.\n\n` +
          `  reserved: $${detail.reservedUsd.toFixed(4)}\n` +
          `  real:     $${detail.realCostUsd.toFixed(4)}\n` +
          `  tenant:   ${detail.tenantId}\n` +
          `  op:       ${detail.operation}\n\n` +
          `AUTOMATIC low-κ Fusion second opinions are now DISABLED for this process to keep the daily HARD cap ` +
          `($${FUSION_DAILY_BUDGET_USD}/day) from being overshot. On-demand owner use is unaffected.\n\n` +
          `Action: raise FUSION_CALL_ESTIMATE_USD (or the FUSION_WORST_CASE_* rate constants) above the ` +
          `observed real cost, then restart.`,
      });
    } catch (err) {
      logSilentCatch("server/second-opinion.ts", err);
    }
  })();
  return true;
}

/**
 * Resolve the effective Fusion daily cap for a tenant. Owner tenant → the
 * configured $25/day default (FUSION_DAILY_BUDGET_USD). Any other tenant → $0
 * unless explicitly provisioned via FUSION_TENANT_BUDGETS_USD (JSON map of
 * tenantId→USD/day) — so an autonomous loop can never spend the owner's money
 * on an unprovisioned tenant. Mirrors the autonomous-budget owner-economics.
 */
export function resolveFusionCapUsd(tenantId: number): number {
  const raw = process.env.FUSION_TENANT_BUDGETS_USD;
  if (raw) {
    try {
      const map = JSON.parse(raw);
      const v = parseFloat(String(map?.[String(tenantId)]));
      if (Number.isFinite(v) && v >= 0) return v;
    } catch (_silentErr) { logSilentCatch("server/second-opinion.ts", _silentErr); }
  }
  if (tenantId === ownerTenantId()) return FUSION_DAILY_BUDGET_USD;
  return 0;
}

interface FusionReservation {
  ok: boolean;
  /** Set only when ok && a real reservation row was written (fail-open grants ok with no row). */
  reservationId?: number;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  degraded: boolean;
}

/** Injectable atomic reservation primitive (tests substitute a query-free fake). */
export interface FusionReserveDeps {
  reserve?: (args: {
    tenantId: number;
    estimateUsd: number;
    capUsd: number;
    toolName: string;
    operation: string;
  }) => Promise<{ ok: boolean; reservationId?: number; spentUsd: number }>;
}

/**
 * Default atomic reservation: serialize per-tenant on an advisory xact lock, sum
 * today's committed + already-reserved second_opinion spend, and INSERT a
 * reservation row (cost = estimate) ONLY if it stays within cap. The lock + the
 * read-and-insert in ONE transaction is what makes this atomic — without it,
 * concurrent callers all read the pre-insert total. Released on commit/rollback.
 */
async function defaultReserve(args: {
  tenantId: number;
  estimateUsd: number;
  capUsd: number;
  toolName: string;
  operation: string;
}): Promise<{ ok: boolean; reservationId?: number; spentUsd: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fusion-second-opinion-claim'), ${args.tenantId})`);
    // SUM = today's committed + already-reserved spend (the cap check).
    // MAX over SETTLED rows = the largest REAL cost actually billed today — the
    // dynamic floor: once a real call has settled ABOVE the static estimate,
    // every subsequent reserve floors at that observed cost so a drifted price
    // can't keep being under-reserved (closes the post-drift second wave).
    const r: any = await tx.execute(sql`
      SELECT COALESCE(SUM(cost_usd::numeric), 0)::float AS total,
             COALESCE(MAX(cost_usd::numeric) FILTER (WHERE operation NOT LIKE '%:reserved'), 0)::float AS max_settled
      FROM agent_cost_ledger
      WHERE tenant_id = ${args.tenantId}
        AND created_at >= date_trunc('day', now())
        AND tool_name LIKE 'second_opinion%'
    `);
    const rows = r.rows || r;
    const spentUsd = parseFloat(rows?.[0]?.total ?? 0) || 0;
    const maxSettledUsd = parseFloat(rows?.[0]?.max_settled ?? 0) || 0;
    const effectiveEstimate = fusionReserveFloorUsd(args.estimateUsd, maxSettledUsd);
    if (spentUsd + effectiveEstimate > args.capUsd) {
      return { ok: false, spentUsd };
    }
    const ins: any = await tx.execute(sql`
      INSERT INTO agent_cost_ledger (tenant_id, tool_name, model, cost_usd, tokens_in, tokens_out, operation, created_at)
      VALUES (${args.tenantId}, ${args.toolName}, ${FUSION_MODEL_ID}, ${effectiveEstimate.toFixed(6)}, 0, 0, ${`${args.operation}:reserved`}, now())
      RETURNING id
    `);
    const insRows = ins.rows || ins;
    const reservationId = Number(insRows?.[0]?.id) || undefined;
    return { ok: true, reservationId, spentUsd };
  });
}

/**
 * Per-call reservation floor: never below the deterministic static estimate, and
 * never below the largest REAL cost already observed today (the post-drift
 * dynamic floor). Pure + exported so the floor invariant is unit-testable
 * without a DB round-trip.
 */
export function fusionReserveFloorUsd(estimateUsd: number, maxObservedTodayUsd: number): number {
  const observed = Number.isFinite(maxObservedTodayUsd) && maxObservedTodayUsd > 0 ? maxObservedTodayUsd : 0;
  return Math.max(estimateUsd, observed);
}

/**
 * Atomically RESERVE Fusion budget BEFORE the paid call. A plain read gate
 * ("is today's spend < cap?") is race-prone: concurrent low-κ ensembles can ALL
 * read "under cap" before any of their costs land in the ledger and collectively
 * blow the HARD daily cap. The reservation row IS the row later settled in place
 * to the real usage.cost (no double count). Fails CLOSED on any txn/ledger error
 * we can't complete (can't prove we're under cap) unless FUSION_BUDGET_FAILOPEN=true.
 */
export async function reserveFusionBudget(
  tenantId: number,
  estimateUsd: number,
  toolName: string,
  operation: string,
  deps: FusionReserveDeps = {},
): Promise<FusionReservation> {
  const capUsd = resolveFusionCapUsd(tenantId);
  if (capUsd <= 0) {
    return { ok: false, spentUsd: 0, capUsd, remainingUsd: 0, degraded: false };
  }
  const reserve = deps.reserve ?? defaultReserve;
  try {
    const res = await reserve({ tenantId, estimateUsd, capUsd, toolName, operation });
    if (!res.ok) {
      return { ok: false, spentUsd: res.spentUsd, capUsd, remainingUsd: Math.max(0, capUsd - res.spentUsd), degraded: false };
    }
    return {
      ok: true,
      reservationId: res.reservationId,
      spentUsd: res.spentUsd,
      capUsd,
      remainingUsd: Math.max(0, capUsd - res.spentUsd - estimateUsd),
      degraded: false,
    };
  } catch (err) {
    logSilentCatch("server/second-opinion.ts", err);
    // HARD ceiling: a reservation we can't complete means we can't prove we're
    // under the Fusion cap, so fail CLOSED. Opt into fail-open loudly.
    const failOpen = (process.env.FUSION_BUDGET_FAILOPEN || "").trim().toLowerCase() === "true";
    console.warn(
      `[second-opinion] Fusion budget reserve FAILED — failing ${failOpen ? "OPEN (FUSION_BUDGET_FAILOPEN)" : "CLOSED (hard ceiling)"}: ${(err as Error)?.message || err}`,
    );
    return { ok: failOpen, spentUsd: 0, capUsd, remainingUsd: failOpen ? capUsd : 0, degraded: true };
  }
}

/** Settle a reservation row in place to the REAL spend (best-effort; never throws). */
async function settleFusionReservation(
  reservationId: number | undefined,
  costUsd: number,
  tokensIn: number,
  tokensOut: number,
  operation: string,
): Promise<void> {
  if (!reservationId) return;
  try {
    await db.execute(sql`
      UPDATE agent_cost_ledger
      SET cost_usd = ${costUsd.toFixed(6)}, tokens_in = ${tokensIn}, tokens_out = ${tokensOut}, operation = ${operation}
      WHERE id = ${reservationId}
    `);
  } catch (err) {
    logSilentCatch("server/second-opinion.ts", err);
  }
}

/**
 * Release a reservation a call never actually spent (cost → 0) so a failed
 * pre-response error doesn't permanently consume the daily cap. NOT called on
 * timeout: a timed-out Fusion call has likely already done paid panel/judge work,
 * so its estimate is kept (conservative for a HARD cap). Best-effort; never throws.
 */
async function releaseFusionReservation(reservationId: number | undefined): Promise<void> {
  if (!reservationId) return;
  try {
    await db.execute(sql`
      UPDATE agent_cost_ledger
      SET cost_usd = '0', operation = 'second_opinion:released'
      WHERE id = ${reservationId}
    `);
  } catch (err) {
    logSilentCatch("server/second-opinion.ts", err);
  }
}

export function parseAgreement(text: string): SecondOpinionAgreement {
  const m = /VERDICT:\s*(AGREE|PARTIAL|DISAGREE)/i.exec(text || "");
  if (!m) return "unknown";
  const v = m[1].toLowerCase();
  return v === "agree" ? "agree" : v === "disagree" ? "disagree" : "partial";
}

export function buildMessages(question: string, draftAnswer?: string): Array<{ role: "system" | "user"; content: string }> {
  const hasDraft = typeof draftAnswer === "string" && draftAnswer.trim().length > 0;
  const system = hasDraft
    ? "You are an independent expert giving a SECOND OPINION. Another agent has produced a draft answer to the question below. " +
      "First, answer the question yourself from scratch — do NOT defer to the draft. Then critically assess the draft: is it correct, complete, and well-reasoned? " +
      "Begin your reply with a single line exactly in the form `VERDICT: AGREE` or `VERDICT: PARTIAL` or `VERDICT: DISAGREE` (AGREE = the draft is sound; PARTIAL = mostly right but has gaps or errors; DISAGREE = materially wrong). " +
      "After that line, give your own answer and then a short, specific critique of the draft naming any concrete errors or omissions."
    : "You are an independent expert giving a careful, well-reasoned second opinion on the question below. Be specific, flag any uncertainty, and cite concrete reasoning.";
  // Truncate the (otherwise unbounded) question so the per-call cost stays
  // bounded — this is half of what makes FUSION_CALL_ESTIMATE_USD a real
  // worst-case bound (the other half is the max_tokens output cap below).
  const userParts = [`QUESTION:\n${question.slice(0, FUSION_MAX_QUESTION_CHARS)}`];
  if (hasDraft) userParts.push(`\nDRAFT ANSWER TO ASSESS:\n${draftAnswer!.trim().slice(0, 12000)}`);
  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n") },
  ];
}

/**
 * Get an independent second opinion from OpenRouter Fusion. NEVER throws —
 * always resolves to a SecondOpinionResult (ok:false on any skip/failure).
 */
export async function getSecondOpinion(opts: GetSecondOpinionOpts): Promise<SecondOpinionResult> {
  const t0 = Date.now();
  const question = String(opts.question || "").trim();
  if (question.length < 10) {
    return { ok: false, skipped: "invalid", error: "question must be ≥10 chars" };
  }

  // Fail-closed cost-drift latch — gates BOTH the AUTO and on-demand spend paths
  // (the moa.ts auto-hook also checks fusionAutoEnabled(), so this is belt-and-
  // suspenders for it + the sole gate for direct/on-demand callers). A deliberate
  // human can pass ownerOverride to bypass once the cost floor has been raised.
  if (autoSpendLatchTripped && !opts.ownerOverride) {
    return {
      ok: false,
      skipped: "latched",
      error: `Fusion cost-drift latch tripped (${autoSpendLatchReason}) — auto-disabled until the reservation floor is raised and the process restarts (or pass ownerOverride)`,
    };
  }

  // Resolve the client FIRST (no spend) so a wiring failure never orphans a
  // budget reservation.
  let client: any;
  let actualModelId = FUSION_MODEL_ID;
  try {
    const resolved = await getClientForModel(FUSION_MODEL_ID, opts.tenantId, { costExemptLane: true });
    client = resolved.client;
    actualModelId = resolved.actualModelId;
  } catch (err) {
    logSilentCatch("server/second-opinion.ts", err);
    return { ok: false, skipped: "wiring", error: `Fusion client unavailable: ${(err as Error)?.message || err}` };
  }

  const toolName = opts.auto ? "second_opinion_auto" : "second_opinion";
  const operation = opts.auto ? `second_opinion_auto:${opts.reason || "low-confidence"}` : "second_opinion";

  // Atomic reserve-before-spend: holds the per-call estimate against the HARD cap
  // under an advisory lock so concurrent calls can't collectively overshoot.
  const budget = await reserveFusionBudget(opts.tenantId, FUSION_CALL_ESTIMATE_USD, toolName, operation);
  if (!budget.ok) {
    const reason =
      budget.capUsd <= 0
        ? `no Fusion budget provisioned for tenant ${opts.tenantId}`
        : budget.degraded
          ? "Fusion budget ledger unreadable (failed closed)"
          : `Fusion daily budget reached ($${budget.spentUsd.toFixed(2)} / $${budget.capUsd.toFixed(2)})`;
    return {
      ok: false,
      skipped: "budget",
      error: reason,
      budget: {
        spentUsd: budget.spentUsd,
        capUsd: budget.capUsd,
        remainingUsd: budget.remainingUsd,
        degraded: budget.degraded,
      },
    };
  }

  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol("fusion-timeout");
  try {
    const createPromise = client.chat.completions.create(
      {
        model: actualModelId,
        messages: buildMessages(question, opts.draftAnswer),
        // Output ceiling — bounds the dominant variable cost of the synthesis
        // so a single call's real usage.cost stays under the reserved estimate
        // (concurrent low-κ auto-calls can't collectively overshoot the HARD cap).
        max_tokens: FUSION_MAX_OUTPUT_TOKENS,
        // OpenRouter usage accounting → usage.cost (USD) for the whole
        // panel+judge+synthesis pipeline. Cast: not in the OpenAI SDK type.
        usage: { include: true },
      } as any,
      // SDK-level deadline + abort signal (honored when the cost-tracking
      // wrapper forwards request options).
      { signal: controller.signal, timeout: timeoutMs } as any,
    );
    // Swallow a late abort-rejection that arrives AFTER the race already timed
    // out, so it never surfaces as an unhandled rejection.
    createPromise.catch(() => {});
    const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        try { controller.abort(); } catch (_silentErr) { logSilentCatch("server/second-opinion.ts", _silentErr); }
        resolve(TIMED_OUT);
      }, timeoutMs);
    });
    // HARD upper bound on how long this blocks the caller — critical because the
    // MoA auto-hook awaits this synchronously before returning the ensemble. On
    // timeout we fail OPEN (worst case: no second opinion), never a stalled turn.
    const raced: any = await Promise.race([createPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    if (raced === TIMED_OUT) {
      console.warn(`[second-opinion] Fusion call timed out after ${timeoutMs}ms (tenant=${opts.tenantId}${opts.auto ? " AUTO" : ""}) — failing open`);
      return { ok: false, skipped: "error", error: `Fusion call timed out after ${timeoutMs}ms`, model: actualModelId, latencyMs: Date.now() - t0 };
    }
    const resp: any = raced;

    const answer = resp?.choices?.[0]?.message?.content || "";
    const usage = resp?.usage || {};
    const tokensIn = Number(usage.prompt_tokens || usage.input_tokens || 0);
    const tokensOut = Number(usage.completion_tokens || usage.output_tokens || 0);
    const realCost = typeof usage.cost === "number" ? usage.cost : null;

    // Settle the reservation row IN PLACE to the REAL spend (no second insert →
    // no double count). The row already counts toward the dedicated Fusion
    // daily-cap query; we just swap the estimate for the actual usage.cost. If
    // usage.cost is absent we keep the (conservative) estimate so the cap never
    // under-counts a real call.
    await settleFusionReservation(budget.reservationId, realCost ?? FUSION_CALL_ESTIMATE_USD, tokensIn, tokensOut, operation);

    // Provider-anchored verification of the heuristic worst-case bound: we
    // reserved FUSION_CALL_ESTIMATE_USD assuming it was an upper bound. If the
    // REAL usage.cost exceeded it, the heuristic under-estimated → trip the
    // fail-closed drift latch so the AUTO path can't repeat the overshoot.
    // (settle already wrote the real cost to the ledger, so the cap now counts
    // this call in full; the latch stops the NEXT one.)
    if (realCost != null && realCost > FUSION_CALL_ESTIMATE_USD) {
      tripFusionAutoLatch({ reservedUsd: FUSION_CALL_ESTIMATE_USD, realCostUsd: realCost, tenantId: opts.tenantId, operation });
    }

    const latencyMs = Date.now() - t0;
    console.log(
      `[second-opinion] tenant=${opts.tenantId} via=${opts.invokedVia || "tool"}${opts.auto ? " AUTO" : ""} ${latencyMs}ms len=${answer.length} cost=${realCost != null ? `$${realCost.toFixed(4)}` : "unknown"}${opts.reason ? ` reason=${opts.reason}` : ""}`,
    );

    if (!answer || answer.trim().length === 0) {
      return { ok: false, skipped: "error", error: "Fusion returned an empty answer", model: actualModelId, costUsd: realCost, latencyMs };
    }

    return {
      ok: true,
      answer,
      agreement: typeof opts.draftAnswer === "string" && opts.draftAnswer.trim() ? parseAgreement(answer) : undefined,
      model: actualModelId,
      costUsd: realCost,
      latencyMs,
      budget: {
        spentUsd: budget.spentUsd,
        capUsd: budget.capUsd,
        remainingUsd: budget.remainingUsd,
        degraded: budget.degraded,
      },
    };
  } catch (err) {
    if (timer) clearTimeout(timer);
    logSilentCatch("server/second-opinion.ts", err);
    const aborted = controller.signal.aborted;
    // A genuine pre-response error (e.g. connection refused) never spent — release
    // its reservation. An abort means the call likely already did paid panel/judge
    // work, so we KEEP the estimate (conservative for a HARD cap).
    if (!aborted) await releaseFusionReservation(budget.reservationId);
    return {
      ok: false,
      skipped: "error",
      error: aborted ? `Fusion call timed out after ${timeoutMs}ms` : `Fusion call failed: ${(err as Error)?.message || err}`,
      model: actualModelId,
      latencyMs: Date.now() - t0,
    };
  }
}
