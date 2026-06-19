/**
 * repair-incident.ts — Repo Surgeon Task #51
 *
 * Unified incident capture + judgment classifier for autonomous self-repair.
 *
 * Three failure sources emit ONE structured incident record:
 *   - runtime_self_heal   (server/agentic/self-heal.ts)
 *   - ci_self_heal        (scripts/agentic-ci-self-heal.ts)
 *   - felix_deliverable   (server/delivery-pipeline.ts)
 *
 * The classifier labels each incident as one of four kinds and routes it:
 *   - transient_infra      → retry             (network/timeout/5xx/rate-limit)
 *   - deliverable_quality  → felix_revise      (Felix grade-below-bar; its own loop)
 *   - safety_guard         → surface           (a guard/check firing CORRECTLY)
 *   - code_defect          → repo_surgeon      (a genuine bug — handed to the fixer)
 *
 * Borderline cases go to the multi-model jury (juryTriage). Low-confidence or
 * split-jury decisions ESCALATE to the owner instead of guessing.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HARD INVARIANT (non-negotiable — see task #51 / replit.md AHB):
 *   A safety-guard-firing-correctly incident, OR any incident whose fix would
 *   touch a test / guard / safety-profile surface, is NEVER routed to an
 *   automated code fix. It surfaces or escalates. `enforceSafetyRouting()` is
 *   the belt-and-suspenders final gate — it overrides even a jury "FIX" verdict
 *   and records `safetyBlockedAutofix=true` so the block is observable.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The pure decision functions (`classifyIncidentHeuristic`, `enforceSafetyRouting`,
 * and the predicate helpers) are exported and side-effect-free so they can be
 * unit-tested without a database or the LLM jury. `captureIncident()` is the
 * stateful orchestrator (resolves tool risk, runs the jury, persists, escalates)
 * and pulls every heavy dependency in via dynamic import.
 */

import { logSilentCatch } from "../lib/silent-catch";

export type IncidentSource = "runtime_self_heal" | "ci_self_heal" | "felix_deliverable";
export type IncidentClassification =
  | "transient_infra"
  | "deliverable_quality"
  | "safety_guard"
  | "code_defect"; // NOTE: no "unknown" — every incident MUST land in one of these 4 (Task #51 contract)
export type IncidentRouting =
  | "retry"
  | "felix_revise"
  | "repo_surgeon"
  | "surface"
  | "escalate_owner";
export type ClassifiedBy = "rule" | "heuristic" | "jury" | "fallback";

/** What a failure source hands to `captureIncident`. */
export interface RawIncident {
  tenantId: number;
  source: IncidentSource;
  title?: string;
  /** Short stable signature for dedup/tuning (CI rule id, error class, etc). */
  signature?: string;
  /** Primary signal — the error message / failing-assertion text. */
  error?: string;
  errorStack?: string;
  /** Raw logs blob (CI job output, etc). */
  logs?: string;
  /** The failing command / pipeline stage. */
  stage?: string;
  /** Candidate / recently-changed files (last 72h) the fix might touch. */
  candidateFiles?: string[];
  /** Runtime tool context. */
  lastToolName?: string;
  lastToolArgs?: any;
  lastToolError?: string;
  /** Explicit guard signals (caller may set; the classifier also infers). */
  refused?: boolean; // detectRefusal() returned non-null
  toolPolicyBlocked?: boolean; // enforceToolPolicy() returned { action: "block" }
  /** Felix-specific failure kind. */
  felixFailureKind?: "grade_below_bar" | "verify_failed" | "delivery_infra" | string;
  /** CI-specific: a rule that explicitly refuses to auto-fix (human-review gate). */
  ciRuleId?: string;
  ciNoAutoFix?: boolean;
  /** Pre-resolved tool risk class ("LOW"|"MEDIUM"|"HIGH"|"CRITICAL"); else resolved in capture. */
  lastToolRiskClass?: string;
  /**
   * A jury decision the caller already computed (e.g. the CI self-healer runs
   * juryTriage before notifying). Reused for borderline incidents so the jury
   * (~5x cost) is not invoked twice for the same failure.
   */
  precomputedJury?: any;
  /**
   * Audit-sourced autopilot signal. Set ONLY by the nightly tenant-isolation
   * audit producer (via the jury queue). When true, repo-surgeon MAY auto-apply
   * a fix that touches a broad app-source aggregator surface (server/routes/*,
   * server/tools.ts, server/chat-engine.ts) WITHOUT the usual owner-HITL pause —
   * but ONLY when env SECURITY_CORE_AUTOFIX=1 AND none of the touched files is a
   * HARD-HITL surface (schema/auth/payments/safety, which always escalate). The
   * cardinal-sin guards (diffWeakensGuard + the protected-surface path denylist)
   * still apply absolutely. No other producer ever sets this.
   */
  securityCoreAllowed?: boolean;
  /** Arbitrary extra detail to persist verbatim. */
  metadata?: any;
}

export interface ClassificationResult {
  classification: IncidentClassification;
  /** 0..1 — below CONFIDENCE_FLOOR escalates to the owner. */
  confidence: number;
  reason: string;
  routedTo: IncidentRouting;
  classifiedBy: ClassifiedBy;
  /** True when the safety invariant forced this incident away from auto-fix. */
  safetyBlockedAutofix: boolean;
}

// Below this confidence we refuse to guess and escalate to the owner.
export const CONFIDENCE_FLOOR = 0.5;
// Jury FIX proposals must agree on the DIRECTION of the fix, not just the label
// (coupled-verifier Goodhart guard). Below this, escalate instead of auto-fixing.
export const FIX_CONCORDANCE_FLOOR = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Signal patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A file path whose modification would weaken a test, guard, or safety profile.
 * Touching any of these to make a check "pass" is the cardinal sin self-repair
 * must never commit.
 */
const PROTECTED_SURFACE_RE =
  /(^|[\/\\])(tests?|__tests__|e2e)[\/\\]|\.(test|spec)\.[cm]?[jt]sx?$|[\/\\]safety[\/\\]|[\/\\]security[\/\\]|intent[-_]?gate|destructive-tool-policy|ahb[-_]?regression|safety[-_]?profile|guarded-tool-executor/i;

/**
 * Error-text markers that mean a guard fired CORRECTLY (refusal / policy block /
 * content filter). These are "the system working as intended", never a bug.
 */
const GUARD_FIRED_RE =
  /\b(refus(al|ed|es)|content[_ ]?filter|policy[_ ]?block|restricted to trusted personas|requires a fresh agent_approvals|requires approval|blocked by (policy|the )|intent[- ]?gate (blocked|refused)|\[(CRITICAL|HIGH)-risk\]|destructive[- ]tool policy)\b/i;

/**
 * Transient / infrastructure errors — safe to simply retry. No code is broken.
 */
const TRANSIENT_RE =
  /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|ESOCKETTIMEDOUT|socket hang ?up|network (error|timeout)|timed? ?out|timeout|rate[ _-]?limit(ed)?|too many requests|HTTP (429|500|502|503|504)|\b(429|502|503|504)\b|temporarily unavailable|service unavailable|deadlock detected|connection (reset|refused|closed|terminated)|fetch failed|request aborted|upstream connect error)\b/i;

/**
 * Deterministic code-defect signals — compile/type/runtime breakage that points
 * at a genuine bug in app code (NOT in a protected surface; that's gated separately).
 */
const CODE_DEFECT_RE =
  /\bTS\d{3,5}\b|\b(ReferenceError|TypeError|SyntaxError|RangeError)\b|is not a function|is not defined|cannot read propert(y|ies)|cannot access .* before initialization|undefined is not|null is not an object|Unexpected (token|identifier|end of)|Cannot find (module|name)|export .* not found|duplicate identifier/i;

/** Felix grade-below-bar / quality-critique signals (its own revise loop owns these). */
const FELIX_QUALITY_RE =
  /\b(grade|score|rubric|critique|near[- ]?miss|below (the )?(passing )?bar|quality gate|passingGradeBar)\b/i;

/** CI rule ids that intentionally refuse auto-fix and demand human review. */
const CI_NO_AUTOFIX_RULES = [
  "sql-raw-callsite",
  "sql-raw-callsite-snapshot-drift",
  "stale-string",
  "stale-string-preflight",
  "ahb-regression",
  "security",
];

function blob(raw: RawIncident): string {
  return [
    raw.error,
    raw.errorStack,
    raw.lastToolError,
    raw.logs,
    raw.stage,
    raw.title,
    raw.signature,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Pull repo-relative source paths implicated by THIS incident out of the
 * error / stack / logs text (e.g. "server/tools.ts:5701", "at ./shared/x.ts").
 * These are the files the failure actually points at — correct to record AND to
 * feed the safety gate. Exported for testing.
 */
export function extractCandidateFilesFromText(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  // Matches paths under common source roots, with optional ./ and :line:col.
  const re =
    /(?:^|[\s("'`@])(?:\.\/)?((?:server|client|shared|scripts|tests|src)\/[\w./-]+\.[cm]?[jt]sx?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const p = m[1].replace(/[:.,)]+$/, "");
    if (p) seen.add(p);
    if (seen.size >= 30) break;
  }
  return [...seen];
}

/**
 * Best-effort list of files changed in the repo in the last 72h — broad context
 * for the incident record and the downstream fixer. Deliberately NOT fed into
 * the safety gate: an unrelated recent edit to some test file must not force
 * every code-defect incident to escalate. Never throws.
 */
async function recentChangesLast72h(): Promise<string[]> {
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(
      "git",
      ["log", "--since=72 hours ago", "--name-only", "--pretty=format:", "--no-merges"],
      { encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
    );
    const files = new Set<string>();
    for (const line of out.split("\n")) {
      const f = line.trim();
      if (f) files.add(f);
      if (files.size >= 200) break;
    }
    return [...files];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure predicates (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

/** True when the fix would touch a test / guard / safety-profile file. */
export function touchesProtectedSurface(raw: RawIncident): boolean {
  const files = raw.candidateFiles || [];
  if (files.some((f) => PROTECTED_SURFACE_RE.test(f))) return true;
  // Also catch a protected path mentioned inline in the error/stack/logs.
  return PROTECTED_SURFACE_RE.test(blob(raw));
}

/** True when a safety guard fired correctly (refusal / policy block / content filter). */
export function guardFiredCorrectly(raw: RawIncident): boolean {
  if (raw.refused === true) return true;
  if (raw.toolPolicyBlocked === true) return true;
  // A destructive/critical tool that errored at the policy layer.
  if (
    (raw.lastToolRiskClass === "CRITICAL" || raw.lastToolRiskClass === "HIGH") &&
    GUARD_FIRED_RE.test(blob(raw))
  ) {
    return true;
  }
  return GUARD_FIRED_RE.test(blob(raw));
}

/** True when a CI rule explicitly refuses to auto-fix (security/brand human-review gate). */
export function isProtectedCiRule(raw: RawIncident): boolean {
  if (raw.ciNoAutoFix === true) return true;
  const id = (raw.ciRuleId || "").toLowerCase().trim();
  if (!id) return false;
  // Match the rule IDENTIFIER exactly (or the segment after a "prefix:" namespace
  // such as "noop-heal:sql-raw-callsite") — NEVER a substring of free-form
  // log/path text. A genuine code defect whose error merely mentions "security"
  // or a "tests/security/..." path must not masquerade as a protected rule.
  const segment = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  return CI_NO_AUTOFIX_RULES.some((r) => id === r || segment === r);
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic classifier (pure — returns null when borderline → jury)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fast, deterministic, side-effect-free first pass. Returns a confident
 * classification, or `null` when the incident is genuinely ambiguous and should
 * go to the jury. Safety recognition runs FIRST and fails closed.
 */
export function classifyIncidentHeuristic(raw: RawIncident): ClassificationResult | null {
  // 1. Safety guard firing correctly — the single most important judgment.
  if (guardFiredCorrectly(raw)) {
    return {
      classification: "safety_guard",
      confidence: 0.97,
      reason:
        "A safety guard fired correctly (refusal / policy block / content filter). This is the system working as intended — surface and re-run, never auto-fix.",
      routedTo: "surface",
      classifiedBy: "rule",
      safetyBlockedAutofix: true,
    };
  }

  // 2. CI rule that intentionally demands human review (sql.raw drift, stale
  //    strings, AHB regression). These are guard-like checks; never auto-fix.
  if (isProtectedCiRule(raw)) {
    return {
      classification: "safety_guard",
      confidence: 0.95,
      reason: `CI rule "${raw.ciRuleId || "(flagged)"}" intentionally refuses auto-fix (security/brand human-review gate). Surface for a human.`,
      routedTo: "surface",
      classifiedBy: "rule",
      safetyBlockedAutofix: true,
    };
  }

  const text = blob(raw);

  // 3. Felix deliverable quality — its own grade/revise loop owns these.
  if (raw.source === "felix_deliverable") {
    if (raw.felixFailureKind === "delivery_infra") {
      return {
        classification: "transient_infra",
        confidence: 0.85,
        reason: "Felix delivery-infra failure (Drive/email transport) — retry.",
        routedTo: "retry",
        classifiedBy: "heuristic",
        safetyBlockedAutofix: false,
      };
    }
    if (raw.felixFailureKind === "grade_below_bar" || FELIX_QUALITY_RE.test(text)) {
      return {
        classification: "deliverable_quality",
        confidence: 0.85,
        reason: "Felix deliverable scored below its passing bar — hand back to Felix's own auto-revise loop, not a code fix.",
        routedTo: "felix_revise",
        classifiedBy: "heuristic",
        safetyBlockedAutofix: false,
      };
    }
  }

  // 4. Transient / infra — retry, nothing is broken.
  if (TRANSIENT_RE.test(text)) {
    return {
      classification: "transient_infra",
      confidence: 0.85,
      reason: "Transient infrastructure error (network/timeout/5xx/rate-limit/deadlock) — safe to retry.",
      routedTo: "retry",
      classifiedBy: "heuristic",
      safetyBlockedAutofix: false,
    };
  }

  // 5. Genuine code defect — route to Repo Surgeon. If the fix would touch a
  //    protected surface, enforceSafetyRouting() reroutes it to escalate_owner.
  if (CODE_DEFECT_RE.test(text)) {
    return {
      classification: "code_defect",
      confidence: 0.8,
      reason: "Deterministic code-defect signal (compile/type/runtime breakage) — candidate for an automated code fix.",
      routedTo: "repo_surgeon",
      classifiedBy: "heuristic",
      safetyBlockedAutofix: false,
    };
  }

  // Ambiguous — let the jury decide.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety enforcement (belt-and-suspenders — runs AFTER every classifier path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Final, authoritative safety gate. Runs after the heuristic OR the jury, so
 * even a jury "FIX" verdict cannot route a guard-firing or protected-surface
 * incident to an automated code fix. This is the single enforcement chokepoint
 * for the hard invariant.
 *
 * APPLY-TIME CONTRACT (Task #52 executor): at classification time the fix has
 * not been computed, so `touchesProtectedSurface` can only see signals already
 * present in `candidateFiles` / error / stack / logs. A `routedTo:"repo_surgeon"`
 * verdict is therefore a CANDIDATE, not a licence to auto-apply. The Repo
 * Surgeon executor MUST re-run `enforceSafetyRouting()` with the ACTUAL diff's
 * touched files populated into `candidateFiles` before applying ANY change, and
 * fail closed (escalate) if that re-check trips. That is where "any incident
 * whose fix would touch a test/guard/safety surface" is authoritatively blocked.
 */
export function enforceSafetyRouting(
  raw: RawIncident,
  result: ClassificationResult,
): ClassificationResult {
  // A guard firing correctly always wins, regardless of upstream verdict.
  if (guardFiredCorrectly(raw) || isProtectedCiRule(raw)) {
    return {
      classification: "safety_guard",
      confidence: Math.max(result.confidence, 0.95),
      reason:
        "Safety override: a guard/check is firing correctly — never auto-fixed. " +
        result.reason,
      routedTo: "surface",
      classifiedBy: result.classifiedBy,
      safetyBlockedAutofix: true,
    };
  }

  // A would-be code fix that touches a test/guard/safety surface must NOT be
  // auto-applied — escalate to a human instead.
  if (result.routedTo === "repo_surgeon" && touchesProtectedSurface(raw)) {
    return {
      ...result,
      routedTo: "escalate_owner",
      reason:
        result.reason +
        " | Safety override: the candidate fix would touch a test/guard/safety surface — escalated to the owner instead of auto-fixed.",
      safetyBlockedAutofix: true,
    };
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jury bridge (borderline cases) — stateful, dynamic imports
// ─────────────────────────────────────────────────────────────────────────────

function juryConfidence(majority: number, total: number): number {
  // Fraction of the jury that agreed, dynamic to jury size: 2-of-3 → ~0.66,
  // 3-of-4 → 0.75, all-agree → 1.0.
  const denom = total > 0 ? total : 3;
  return Math.max(0, Math.min(1, majority / denom));
}

/**
 * Pure mapping from a jury decision to a classification + routing. Exported for
 * unit testing without the LLM jury. Applies the coupled-verifier Goodhart guard
 * (FIX votes must agree on the DIRECTION of the fix, not just the verdict label).
 */
export function mapJuryDecision(jury: any): ClassificationResult {
  const majority = Number(jury?.majority) || 0;
  const total = Array.isArray(jury?.votes) ? jury.votes.length : 3;
  const conf = juryConfidence(majority, total);
  const verdict = jury?.verdict;
  const shouldEscalate = jury?.shouldEscalate === true;
  // Auto-acting on a FIX requires a UNANIMOUS jury (every voter agreed, no
  // dissenter) — dynamic to jury size (3-of-3, 4-of-4, …). ANY split is a
  // contested judgment and MUST escalate to the owner rather than guess.
  const unanimous = total > 0 && majority >= total;
  const lowConcordance =
    typeof jury?.fixConcordance === "number" && jury.fixConcordance < FIX_CONCORDANCE_FLOOR;

  if (verdict === "FIX") {
    // A FIX verdict is always classified as a code_defect; only the ROUTING
    // changes. Escalate (never auto-fix) on ANY of: a non-unanimous split, the
    // jury's own escalation flag (κ<0.5 / single-proposer), or low fix-direction
    // concordance (the coupled-verifier Goodhart guard).
    if (!unanimous || shouldEscalate || lowConcordance) {
      const why = !unanimous
        ? `a non-unanimous split (${majority}/${total}, dissenter present)`
        : shouldEscalate
        ? "jury-flagged for escalation (low κ / single-proposer)"
        : `fix-direction concordance ${Number(jury.fixConcordance).toFixed(2)} < ${FIX_CONCORDANCE_FLOOR} (proposers disagree on WHAT to change)`;
      return {
        classification: "code_defect",
        confidence: conf,
        reason: `Jury voted FIX (${majority}/${total}) but it is ${why} — escalating to the owner instead of auto-fixing.`,
        routedTo: "escalate_owner",
        classifiedBy: "jury",
        safetyBlockedAutofix: false,
      };
    }
    return {
      classification: "code_defect",
      confidence: conf,
      reason: `Jury UNANIMOUSLY voted FIX (${majority}/${total}): ${(jury?.aggregatorAnswer || "").slice(0, 300)}`,
      routedTo: "repo_surgeon",
      classifiedBy: "jury",
      safetyBlockedAutofix: false,
    };
  }

  // A clear, uncontested ACCEPT/REJECT strict majority (no escalation flag): the
  // jury judged this is NOT a fixable code defect — an expected / non-actionable
  // condition. The only remedy is to surface it for the record, never auto-fix,
  // which is exactly the safety_guard "working-as-intended / do-not-fix" bucket.
  if ((verdict === "ACCEPT" || verdict === "REJECT") && majority >= Math.floor(total / 2) + 1 && !shouldEscalate) {
    return {
      classification: "safety_guard",
      confidence: conf,
      reason: `Jury voted ${verdict} (${majority}/${total}) — not an automated-fix candidate (expected / non-actionable). Surface for the record, never auto-fix.`,
      routedTo: "surface",
      classifiedBy: "jury",
      safetyBlockedAutofix: false,
    };
  }

  // ESCALATE verdict, jury-flagged escalation, or no 2-of-3 agreement: a suspected
  // defect the jury could neither clear nor confirm. Label it a candidate
  // code_defect and put it in front of a human — never auto-fix on an unsure jury.
  return {
    classification: "code_defect",
    confidence: conf,
    reason: `Jury ${verdict || "(no verdict)"} (majority ${majority})${shouldEscalate ? ", flagged for escalation" : ", no 2-of-3 agreement"} — owner must judge; not auto-fixed.`,
    routedTo: "escalate_owner",
    classifiedBy: "jury",
    safetyBlockedAutofix: false,
  };
}

async function classifyViaJury(raw: RawIncident): Promise<{
  result: ClassificationResult;
  jury: any | null;
}> {
  // Reuse a jury decision the caller already paid for (e.g. CI self-healer).
  if (raw.precomputedJury) {
    return { jury: raw.precomputedJury, result: mapJuryDecision(raw.precomputedJury) };
  }
  try {
    const { juryTriage } = await import("../lib/jury-triage");
    const issueText = [
      `A self-repair incident from source "${raw.source}" needs classification.`,
      `Decide whether this is a GENUINE CODE DEFECT that warrants an automated code fix (verdict FIX),`,
      `a non-actionable / expected condition (verdict REJECT/ACCEPT), or something a human must judge (ESCALATE).`,
      `NEVER recommend changing a test, guard, or safety profile to make a failure pass.`,
      ``,
      `Stage: ${raw.stage || "(unknown)"}`,
      `Error: ${(raw.error || "(none)").slice(0, 1500)}`,
      raw.lastToolName ? `Last tool: ${raw.lastToolName} (risk ${raw.lastToolRiskClass || "?"})` : "",
      raw.candidateFiles?.length ? `Candidate files: ${raw.candidateFiles.slice(0, 20).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const jury = await juryTriage({
      issueText,
      context: (raw.logs || raw.errorStack || "").slice(0, 2000),
      tenantId: raw.tenantId,
      invokedVia: "repair-incident-classifier",
    });

    return { jury, result: mapJuryDecision(jury) };
  } catch (e: any) {
    // Jury unavailable — fail toward a human, never toward a silent auto-fix.
    return {
      jury: null,
      result: {
        // Jury unreachable on a borderline incident → a suspected (unconfirmed)
        // defect that must go to a human. Conservative within-taxonomy label;
        // the escalate routing guarantees it is never auto-fixed.
        classification: "code_defect",
        confidence: 0,
        reason: `Classifier could not reach the jury (${e?.message?.slice(0, 160) || "unknown error"}) — escalating to the owner.`,
        routedTo: "escalate_owner",
        classifiedBy: "fallback",
        safetyBlockedAutofix: false,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — capture, classify, persist, escalate (stateful)
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureResult {
  incidentId: number | null;
  classification: IncidentClassification;
  routedTo: IncidentRouting;
  confidence: number;
  reason: string;
  classifiedBy: ClassifiedBy;
  safetyBlockedAutofix: boolean;
  escalated: boolean;
}

/**
 * Capture a failure from any source, classify it, persist the structured record,
 * and escalate to the owner when the decision is low-confidence / split. Returns
 * the classification + routing. NEVER throws — self-repair telemetry must not
 * itself break the caller.
 */
export async function captureIncident(raw: RawIncident): Promise<CaptureResult> {
  // Enrich with tool risk class if a tool was involved and the caller didn't set it.
  const enriched: RawIncident = { ...raw };
  if (enriched.lastToolName && !enriched.lastToolRiskClass) {
    try {
      const { getToolRiskClass } = await import("../safety/destructive-tool-policy");
      enriched.lastToolRiskClass = getToolRiskClass(enriched.lastToolName);
    } catch (_silentErr) { logSilentCatch("server/agentic/repair-incident.ts", _silentErr); }
  }
  // Implicated files: parse from the error/stack/logs when the caller didn't
  // supply them. These ARE fed to the safety gate (they're what the failure
  // points at). Recent (last-72h) repo changes are gathered separately for the
  // record + downstream fixer only (NOT the safety gate — see recentChangesLast72h).
  if (!enriched.candidateFiles || enriched.candidateFiles.length === 0) {
    const extracted = extractCandidateFilesFromText(blob(enriched));
    if (extracted.length) enriched.candidateFiles = extracted;
  }
  const recentChanges = await recentChangesLast72h();

  // Heuristic first; jury only when genuinely borderline.
  let result = classifyIncidentHeuristic(enriched);
  let jury: any | null = null;
  if (!result) {
    const j = await classifyViaJury(enriched);
    result = j.result;
    jury = j.jury;
  }

  // Belt-and-suspenders safety enforcement — covers the jury FIX path too.
  result = enforceSafetyRouting(enriched, result);

  // Low confidence → refuse to guess; escalate. (Guard-fired/surface stays as-is;
  // a correctly-firing guard is high-confidence by construction and not a guess.)
  if (
    result.confidence < CONFIDENCE_FLOOR &&
    result.routedTo !== "escalate_owner" &&
    result.routedTo !== "surface"
  ) {
    result = {
      ...result,
      routedTo: "escalate_owner",
      reason: `${result.reason} | Confidence ${result.confidence.toFixed(2)} < ${CONFIDENCE_FLOOR} — escalating instead of guessing.`,
    };
  }

  const willEscalate = result.routedTo === "escalate_owner";

  // Persist (best-effort; telemetry must not break the caller).
  let incidentId: number | null = null;
  try {
    const { ensureRepairIncidentsTable } = await import("./repair-incident-table");
    await ensureRepairIncidentsTable();
    const { db } = await import("../db");
    const { repairIncidents } = await import("@shared/schema");
    const detail = {
      error: raw.error,
      errorStack: raw.errorStack,
      // Full logs/error (capped) so the record carries the complete failure
      // context required for tuning + the downstream fixer, not just a snippet.
      logs: raw.logs ? String(raw.logs).slice(0, 24000) : undefined,
      stage: raw.stage,
      candidateFiles: enriched.candidateFiles,
      recentChanges, // files changed in the repo in the last 72h
      lastToolName: raw.lastToolName,
      lastToolArgs: raw.lastToolArgs,
      lastToolError: raw.lastToolError,
      lastToolRiskClass: enriched.lastToolRiskClass,
      felixFailureKind: raw.felixFailureKind,
      ciRuleId: raw.ciRuleId,
      metadata: raw.metadata,
    };
    const [row] = await db
      .insert(repairIncidents)
      .values({
        tenantId: raw.tenantId,
        source: raw.source,
        signature: (raw.signature || raw.ciRuleId || "").slice(0, 500),
        title: (raw.title || raw.error || raw.stage || "incident").slice(0, 500),
        detail: detail as any,
        classification: result.classification,
        classificationConfidence: result.confidence,
        classificationReason: result.reason.slice(0, 2000),
        classifiedBy: result.classifiedBy,
        routedTo: result.routedTo,
        safetyBlockedAutofix: result.safetyBlockedAutofix,
        juryVerdict: jury?.verdict ?? null,
        juryDetail: jury
          ? ({ majority: jury.majority, concordance: jury.concordance, fixConcordance: jury.fixConcordance, votes: jury.votes } as any)
          : ({} as any),
        escalated: willEscalate,
        classifiedAt: new Date(),
      })
      .returning({ id: repairIncidents.id });
    incidentId = row?.id ?? null;
  } catch (e: any) {
    console.error(`[repair-incident] persist failed (non-fatal): ${e?.message || e}`);
  }

  // Escalate to the owner via the attention bus (same precedent as delivery.failed).
  if (willEscalate) {
    try {
      const { emitEvent } = await import("../event-bus");
      await emitEvent({
        type: "repair.incident.escalated",
        source: "repair-incident-classifier",
        tenantId: raw.tenantId,
        data: {
          incidentId,
          incidentSource: raw.source,
          classification: result.classification,
          confidence: result.confidence,
          reason: result.reason.slice(0, 500),
          title: (raw.title || raw.error || raw.stage || "incident").slice(0, 200),
          juryVerdict: jury?.verdict ?? null,
        },
      });
    } catch (e: any) {
      console.warn(`[repair-incident] escalation emit failed (non-fatal): ${e?.message || e}`);
    }
  }

  // ── Close the loop: dispatch the classified remedy (Task #54) ─────────────
  // Fire-and-forget (detached) so the detector's hot path is never blocked on a
  // typecheck/test run, and so this telemetry can NEVER break the caller. The
  // dispatcher records the action + verified outcome back onto this ledger row.
  // repo_surgeon is the only ACTIVE remedy (and is itself opt-in via
  // REPAIR_AUTOFIX_ENABLED); the rest are owned by the caller's existing loop
  // and recorded as such. Skipped when persistence failed (no row to patch).
  if (incidentId != null) {
    void dispatchIncidentRemedy({
      incidentId,
      tenantId: raw.tenantId,
      routedTo: result.routedTo,
      classification: result.classification,
      enriched,
      recentChanges,
    }).catch((e: any) =>
      console.error(`[repair-incident] dispatch failed (non-fatal): ${e?.message || e}`),
    );
  }

  return {
    incidentId,
    classification: result.classification,
    routedTo: result.routedTo,
    confidence: result.confidence,
    reason: result.reason,
    classifiedBy: result.classifiedBy,
    safetyBlockedAutofix: result.safetyBlockedAutofix,
    escalated: willEscalate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remedy dispatch — close the loop (Task #54)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The autonomous code-fix remedy (`repo_surgeon` routing) is OPT-IN, defaulting
 * OFF — mirroring the JURY_AUTOAPPLY precedent (replit.md: "default OFF protects
 * forks / public-mirror users"). When off, a `repo_surgeon`-routed incident is
 * recorded with `action_outcome='autofix_disabled'` and left in the ledger for a
 * human; it is NEVER silently dropped. Set `REPAIR_AUTOFIX_ENABLED=1` to make the
 * full self-repair loop live. The non-destructive routings (retry / felix_revise
 * / surface / escalate_owner) dispatch regardless — they only RECORD what their
 * own existing loop is already handling.
 */
export function repoSurgeonAutofixEnabled(): boolean {
  return process.env.REPAIR_AUTOFIX_ENABLED === "1";
}

/** The mutable outcome columns the dispatcher writes back to the ledger row. */
export interface LedgerActionPatch {
  actionTaken: string;
  actionOutcome: string;
  actionDetail?: any;
  resolved?: boolean;
  escalated?: boolean;
}

/**
 * Patch an incident row with the remedy that was dispatched and its verified
 * outcome — the auditable record of WHAT the loop did and HOW it was verified.
 * Best-effort; never throws (telemetry must not break the repair loop). Tenant-
 * scoped per the house cross-tenant-WHERE rule.
 */
export async function updateIncidentAction(
  incidentId: number,
  tenantId: number,
  patch: LedgerActionPatch,
): Promise<boolean> {
  try {
    const { db } = await import("../db");
    const { repairIncidents } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const set: any = {
      actionTaken: patch.actionTaken,
      actionOutcome: patch.actionOutcome,
      actionDetail: (patch.actionDetail ?? {}) as any,
      dispatchedAt: new Date(),
    };
    if (patch.resolved) {
      set.resolved = true;
      set.resolvedAt = new Date();
    }
    if (patch.escalated) set.escalated = true;
    const [row] = await db
      .update(repairIncidents)
      .set(set)
      .where(and(eq(repairIncidents.id, incidentId), eq(repairIncidents.tenantId, tenantId)))
      .returning({ id: repairIncidents.id });
    return !!row;
  } catch (e: any) {
    console.error(`[repair-incident] updateIncidentAction failed (non-fatal): ${e?.message || e}`);
    return false;
  }
}

export interface DispatchArgs {
  incidentId: number;
  tenantId: number;
  routedTo: IncidentRouting;
  classification: IncidentClassification;
  /** The enriched incident (candidate files, tool context, logs) for the fixer. */
  enriched: RawIncident;
  /** Files changed in the repo in the last 72h — broad fixer context. */
  recentChanges?: string[];
}

/** Injectable seams so the loop is fully testable without the LLM / shell / DB. */
export interface DispatchDeps {
  runSurgeon?: (
    incident: import("./repo-surgeon").RepoSurgeonIncident,
  ) => Promise<import("./repo-surgeon").RepoSurgeonResult>;
  emitEvent?: (e: { type: string; source: string; tenantId: number; data?: any }) => Promise<any>;
  updateLedger?: (incidentId: number, tenantId: number, patch: LedgerActionPatch) => Promise<boolean>;
  autofixEnabled?: boolean;
}

/**
 * Terminal repo-surgeon outcomes that, although not a clean LAND, must reach the
 * owner — a genuine code defect the loop could not safely auto-resolve. HITL
 * pause routes to the owner too (it IS the sign-off). Rate-limit does not (the
 * incident stays open; the next sweep retries within budget).
 */
const SURGEON_ESCALATE_OUTCOMES = new Set<import("./repo-surgeon").RepoSurgeonOutcome>([
  "rolled_back",
  "blocked_guard_invariant",
  "stopped_attempt_limit",
  "diagnosis_failed",
  "no_fix_proposed",
  "awaiting_hitl",
]);

/**
 * Render the applied find/replace edits (+ any new files) as a compact, readable
 * unified-ish diff for the owner notification. Bounded so a large fix can't blow
 * up the event payload / email. Returns "" when there's nothing to show.
 */
function summarizeDiff(
  edits?: import("./repo-surgeon").FileEdit[],
  newFiles?: import("./repo-surgeon").NewFile[],
): string {
  const MAX_CHARS = 4000;
  const blocks: string[] = [];
  for (const e of edits || []) {
    const minus = e.find.split("\n").map((l) => `- ${l}`).join("\n");
    const plus = e.replace.split("\n").map((l) => `+ ${l}`).join("\n");
    blocks.push(`--- ${e.path}\n${minus}\n${plus}`);
  }
  for (const f of newFiles || []) {
    blocks.push(`+++ ${f.path} (new file)\n${f.content.split("\n").map((l) => `+ ${l}`).join("\n")}`);
  }
  const full = blocks.join("\n\n");
  return full.length > MAX_CHARS ? `${full.slice(0, MAX_CHARS)}\n… (diff truncated)` : full;
}

/**
 * True when a landed fix's structured diff is small enough to store in the
 * ledger row for a future one-click revert (Task #65). Caps the serialized size
 * so a giant diff can't bloat the JSONB. Repo Surgeon emits minimal diffs, so
 * exceeding this is rare; when it does, the fix is recorded non-revertable.
 */
function fitsRevertBudget(plan?: import("./repo-surgeon").RevertPlan): boolean {
  const REVERT_DIFF_MAX_CHARS = 256 * 1024;
  if (!plan || (!plan.files?.length && !plan.createdFiles?.length)) return false;
  try {
    return JSON.stringify(plan).length <= REVERT_DIFF_MAX_CHARS;
  } catch {
    return false;
  }
}

/** One-line summary of how the landed fix was verified (the gates that ran). */
function summarizeVerification(report?: import("./repo-surgeon").VerificationReport): string {
  if (!report?.steps?.length) return "no verification steps recorded";
  return report.steps.map((s) => `${s.name}: ${s.ok ? "pass" : "FAIL"}`).join(", ");
}

/**
 * Dispatch the classified remedy and record the verified outcome in the ledger —
 * the step that turns the #51 classifier's DECISION into an actual self-repair
 * ACTION and closes the loop.
 *
 *   repo_surgeon   → run the guarded code-fix executor (#52), verify, land or
 *                    roll back; escalate to the owner on any non-landed terminal
 *                    outcome. Gated by REPAIR_AUTOFIX_ENABLED (opt-in).
 *   escalate_owner → record + (the owner event was already emitted at capture).
 *   retry / felix_revise / surface → owned by the caller's own existing loop;
 *                    recorded as a no-op dispatch (action_taken='none').
 *
 * Fire-and-forget from `captureIncident` (detached) so the detector's hot path
 * is never blocked on a typecheck/test run. NEVER throws.
 */
export async function dispatchIncidentRemedy(args: DispatchArgs, deps: DispatchDeps = {}): Promise<void> {
  const { incidentId, tenantId, routedTo, enriched, recentChanges } = args;
  const updateLedger = deps.updateLedger ?? updateIncidentAction;
  const autofixEnabled = deps.autofixEnabled ?? repoSurgeonAutofixEnabled();

  try {
    if (routedTo === "repo_surgeon") {
      if (!autofixEnabled) {
        await updateLedger(incidentId, tenantId, {
          actionTaken: "repo_surgeon",
          actionOutcome: "autofix_disabled",
          actionDetail: { note: "REPAIR_AUTOFIX_ENABLED!=1 — code defect recorded for human review, not auto-fixed." },
        });
        return;
      }

      const runSurgeon =
        deps.runSurgeon ?? (await import("./repo-surgeon")).runRepoSurgeon;
      const surgeonIncident: import("./repo-surgeon").RepoSurgeonIncident = {
        incidentId,
        tenantId,
        title: enriched.title,
        error: enriched.error,
        errorStack: enriched.errorStack,
        logs: enriched.logs,
        stage: enriched.stage,
        candidateFiles: enriched.candidateFiles,
        recentChanges,
        lastToolName: enriched.lastToolName,
        lastToolArgs: enriched.lastToolArgs,
        securityCoreAllowed: enriched.securityCoreAllowed,
        metadata: enriched.metadata,
      };

      const result = await runSurgeon(surgeonIncident);
      const resolved = result.outcome === "landed";
      const shouldEscalate = result.escalated || SURGEON_ESCALATE_OUTCOMES.has(result.outcome);

      // Persist the STRUCTURED diff (edits + new files) of a LANDED fix so the
      // owner's one-click revert (Task #65) can reverse-apply it. Bounded so a
      // large diff can't bloat the JSONB row — if it would, drop the structured
      // copy and flag the fix non-revertable (the owner can still review the
      // summarized diff in the email and undo by hand).
      // A landed fix is one-click revertable only when its deterministic undo
      // plan (before/after snapshots) is small enough to keep in the JSONB row.
      // The display diff (find/replace) and the revert plan are stored together;
      // the plan is the superset, so if it fits the diff fits.
      const revertable = resolved && fitsRevertBudget(result.revertPlan);
      await updateLedger(incidentId, tenantId, {
        actionTaken: "repo_surgeon",
        actionOutcome: result.outcome,
        actionDetail: {
          attempts: result.attempts,
          diagnosis: result.diagnosis,
          rootCause: result.rootCause,
          touchedFiles: result.touchedFiles,
          verification: result.verification,
          reasons: result.reasons,
          reason: result.reason,
          ...(resolved
            ? {
                revertable,
                ...(revertable
                  ? { edits: result.edits, newFiles: result.newFiles, revertPlan: result.revertPlan }
                  : {}),
              }
            : {}),
        },
        resolved,
        escalated: shouldEscalate,
      });

      // Non-landed terminal outcome → the loop tried and could not safely close;
      // get a human involved (the surgeon emits its own escalate for some paths,
      // but the dispatcher guarantees the owner is reached for ALL of them).
      if (shouldEscalate) {
        const emit = deps.emitEvent ?? (await import("../event-bus")).emitEvent;
        await emit({
          type: "repair.incident.escalated",
          source: "repair-incident-dispatch",
          tenantId,
          data: {
            incidentId,
            phase: "remedy",
            remedy: "repo_surgeon",
            outcome: result.outcome,
            attempts: result.attempts,
            reason: result.reason.slice(0, 500),
            title: (enriched.title || enriched.error || enriched.stage || "incident").slice(0, 200),
          },
        }).catch((e: any) => console.warn(`[repair-incident] remedy escalate emit failed: ${e?.message || e}`));
      }

      // Landed (verified, all-green) → the system just edited its own live code
      // WITHOUT a human in the loop. Proactively tell the owner so a
      // wrong-but-passing fix can't land unnoticed. (Mirrors the escalate path;
      // separate event type so it's filterable and never confused with a
      // failure.) Best-effort, never throws.
      if (resolved) {
        const emit = deps.emitEvent ?? (await import("../event-bus")).emitEvent;
        await emit({
          type: "repair.incident.autofixed",
          source: "repair-incident-dispatch",
          tenantId,
          data: {
            incidentId,
            phase: "remedy",
            remedy: "repo_surgeon",
            outcome: result.outcome,
            attempts: result.attempts,
            title: (enriched.title || enriched.error || enriched.stage || "incident").slice(0, 200),
            rootCause: (result.rootCause || result.diagnosis || "").slice(0, 800),
            touchedFiles: result.touchedFiles || [],
            diff: summarizeDiff(result.edits, result.newFiles),
            verifiedBy: summarizeVerification(result.verification),
            ledgerLink: `/admin/repair-ledger`,
          },
        }).catch((e: any) => console.warn(`[repair-incident] autofix notify emit failed: ${e?.message || e}`));
      }
      return;
    }

    if (routedTo === "escalate_owner") {
      // The owner event was already emitted at capture; record the action so the
      // ledger reflects the escalation as the dispatched remedy.
      await updateLedger(incidentId, tenantId, {
        actionTaken: "escalate_owner",
        actionOutcome: "escalated",
        escalated: true,
      });
      return;
    }

    // retry / felix_revise / surface — handled by the caller's own existing loop
    // (delivery retries, self-heal replan, Felix revise, surface-only). Record a
    // no-op dispatch so the ledger is complete and the routing is auditable.
    await updateLedger(incidentId, tenantId, {
      actionTaken: "none",
      actionOutcome: "recorded",
      actionDetail: { note: `routed_to=${routedTo} — owned by the caller's existing loop; no autonomous code action.` },
    });
  } catch (e: any) {
    console.error(`[repair-incident] dispatchIncidentRemedy failed (non-fatal): ${e?.message || e}`);
    try {
      await updateLedger(incidentId, tenantId, {
        actionTaken: routedTo === "repo_surgeon" ? "repo_surgeon" : "none",
        actionOutcome: "dispatch_error",
        actionDetail: { error: String(e?.message || e).slice(0, 500) },
      });
    } catch (_e) { logSilentCatch("server/agentic/repair-incident.ts", _e); }
  }
}

/** Apply a human ground-truth label to an incident for classifier tuning. */
export async function labelIncident(
  incidentId: number,
  tenantId: number,
  humanLabel: IncidentClassification,
): Promise<boolean> {
  try {
    const { db } = await import("../db");
    const { repairIncidents } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const [row] = await db
      .update(repairIncidents)
      .set({ humanLabel })
      .where(and(eq(repairIncidents.id, incidentId), eq(repairIncidents.tenantId, tenantId)))
      .returning({ id: repairIncidents.id });
    return !!row;
  } catch (e: any) {
    console.error(`[repair-incident] labelIncident failed: ${e?.message || e}`);
    return false;
  }
}

export interface RevertIncidentResult {
  ok: boolean;
  reason: string;
  revertedFiles?: string[];
  deletedFiles?: string[];
}

/** Injectable seams so revert is testable without fs / DB / event bus. */
export interface RevertIncidentDeps {
  revertFix?: (
    plan: import("./repo-surgeon").RevertPlan | undefined,
  ) => import("./repo-surgeon").RevertResult;
  emitEvent?: (e: { type: string; source: string; tenantId: number; data?: any }) => Promise<any>;
}

/**
 * Owner-driven one-click revert of a LANDED self-repair fix (Task #65). Loads
 * the incident, validates it is a revertable landed repo_surgeon fix that has
 * not already been reverted, reverse-applies the stored diff, and records the
 * revert in the ledger (action_detail.reverted) so the audit trail is complete.
 *
 * The reversed change is left in the working tree for the Auto Git Push workflow,
 * exactly as the original fix was. Idempotent: a second revert of an
 * already-reverted incident is refused. NEVER throws.
 */
export async function revertIncidentFix(
  incidentId: number,
  tenantId: number,
  deps: RevertIncidentDeps = {},
): Promise<RevertIncidentResult> {
  try {
    const { db } = await import("../db");
    const { repairIncidents } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const { ensureRepairIncidentsTable } = await import("./repair-incident-table");
    await ensureRepairIncidentsTable();

    const [row] = await db
      .select()
      .from(repairIncidents)
      .where(and(eq(repairIncidents.id, incidentId), eq(repairIncidents.tenantId, tenantId)))
      .limit(1);

    if (!row) return { ok: false, reason: "Incident not found." };
    if (row.actionTaken !== "repo_surgeon" || row.actionOutcome !== "landed") {
      return { ok: false, reason: "Only a LANDED automated code fix can be reverted." };
    }

    const detail = (row.actionDetail || {}) as any;
    if (detail.reverted === true) {
      return { ok: false, reason: "This fix has already been reverted." };
    }
    if (detail.revertable === false) {
      return { ok: false, reason: "This fix's diff was too large to store for an automatic revert — undo it by hand." };
    }
    const revertPlan = detail.revertPlan as import("./repo-surgeon").RevertPlan | undefined;
    if (!revertPlan || (!revertPlan.files?.length && !revertPlan.createdFiles?.length)) {
      return { ok: false, reason: "No stored undo plan is available for this fix — undo it by hand." };
    }

    const revertFix = deps.revertFix ?? (await import("./repo-surgeon")).revertAppliedFix;
    const result = revertFix(revertPlan);
    if (!result.ok) {
      return { ok: false, reason: result.reasons.join("; ") || "Revert failed." };
    }

    // Record the revert in the ledger. Keep action_outcome="landed" (the original
    // outcome) and mark the revert inside action_detail so history is preserved.
    const revertedDetail = {
      ...detail,
      reverted: true,
      revertedAt: new Date().toISOString(),
      revertResult: {
        revertedFiles: result.revertedFiles,
        deletedFiles: result.deletedFiles,
      },
    };
    await db
      .update(repairIncidents)
      .set({ actionDetail: revertedDetail as any })
      .where(and(eq(repairIncidents.id, incidentId), eq(repairIncidents.tenantId, tenantId)));

    // Tell the owner the auto-fix was undone (best-effort, never throws).
    try {
      const emit = deps.emitEvent ?? (await import("../event-bus")).emitEvent;
      await emit({
        type: "repair.incident.reverted",
        source: "repair-incident-revert",
        tenantId,
        data: {
          incidentId,
          title: (row.title || "incident").slice(0, 200),
          revertedFiles: result.revertedFiles,
          deletedFiles: result.deletedFiles,
        },
      });
    } catch (e: any) {
      console.warn(`[repair-incident] revert notify emit failed: ${e?.message || e}`);
    }

    return {
      ok: true,
      reason: "Fix reverted — the change has been undone in the working tree.",
      revertedFiles: result.revertedFiles,
      deletedFiles: result.deletedFiles,
    };
  } catch (e: any) {
    console.error(`[repair-incident] revertIncidentFix failed: ${e?.message || e}`);
    return { ok: false, reason: `Revert failed: ${e?.message || e}` };
  }
}
