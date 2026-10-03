/**
 * Pure core of the MEMORY-MAINTENANCE offline eval (scripts/memory-maintenance-eval.ts).
 *
 * WHY THIS EXISTS
 *   The agent-memory benchmark literature (arXiv:2606.24775) makes one durable
 *   point worth acting on: memory evals almost always grade the FINAL ANSWER and
 *   therefore never test the memory SYSTEM's own operations — storage, extraction,
 *   retrieval, and crucially MAINTENANCE (how it handles changed / conflicting
 *   facts). VisionClaw already runs an answer-quality golden set (offline-eval),
 *   but had NO held-out test of the maintenance operation itself. This is that
 *   slice: a deterministic, LLM-free, IO-free regression gate over the contradiction
 *   resolver — the function that decides which of two conflicting memories wins and
 *   when a contradiction is too close to call and must escalate to a human.
 *
 * WHY DETERMINISTIC (not an LLM run)
 *   `resolveContradiction` is a pure scoring function (recency × authority × support
 *   × confidence). Its correct behavior is exactly checkable with fixtures, so the
 *   eval costs $0 and never flakes. It catches the real recurring bug class: a
 *   retune of the resolver weights silently flipping which fact "wins", or eroding
 *   the escalate-to-HITL margin so thin contradictions stop being routed to a human.
 *
 * SPLIT (same convention as offline-eval-core)
 *   Pure logic lives HERE in server/lib (inside tsc scope, unit-testable, query-free
 *   — memory node-test-db-pool-hang). The driver in scripts/ supplies the real
 *   `resolveContradiction` call + file IO around these functions.
 */

import { clamp01 } from "./offline-eval-core";

/** Parse an env-derived number to a clamped [0,1] fraction, falling back to a
 *  default when the value is missing / non-finite (Number(undefined) ⇒ NaN). */
export function clampPassthrough(n: number, fallback: number): number {
  return Number.isFinite(n) ? clamp01(n) : clamp01(fallback);
}

/** One conflicting-memory candidate as authored in the fixture. The driver maps
 *  `ageDays` → a concrete `lastReinforcedAt` Date at run time so fixtures stay
 *  time-stable (an absolute date would drift the recency weight as the file ages). */
export interface MaintenanceCandidateSpec {
  id: string;
  text: string;
  /** Age of the supporting source in days (omitted ⇒ unknown recency). Non-negative. */
  ageDays?: number;
  /** 'user'|'manual'|'paper'|'docs'|'api'|'tool'|'conversation'|'auto_capture'|... */
  sourceAuthority?: string;
  /** Independent supporting observations. Non-negative. */
  supportingObservations?: number;
  /** Pre-existing confidence 0..1. */
  confidence?: number;
}

export interface MaintenanceCase {
  id: string;
  category: string;
  candidates: MaintenanceCandidateSpec[];
  /** The candidate id that SHOULD win the contradiction (optional assertion). */
  expectedWinnerId?: string;
  /** Whether this contradiction SHOULD be escalated to HITL (optional assertion). */
  expectedEscalate?: boolean;
  note?: string;
}

export interface MaintenanceActual {
  winnerId: string | null;
  escalate: boolean;
}

export interface MaintenanceCaseResult {
  id: string;
  category: string;
  executed: boolean;
  passed: boolean;
  actualWinnerId: string | null;
  actualEscalate: boolean;
  expectedWinnerId?: string;
  expectedEscalate?: boolean;
  mismatch?: string;
  error?: string;
}

/**
 * Validate + normalize a parsed maintenance-set document. Accepts a bare array of
 * cases or `{ cases: [...] }`. THROWS (fail-closed) on any structural problem so
 * the driver maps it to a config-error exit — never silently drops a case. Every
 * case MUST carry at least one assertion (expectedWinnerId or expectedEscalate),
 * else it tests nothing.
 */
export function validateMaintenanceSet(parsed: unknown): MaintenanceCase[] {
  const cases: unknown = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as any).cases
      : undefined;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("maintenance set has no cases (expected an array or { cases: [...] })");
  }
  const out: MaintenanceCase[] = [];
  const seen = new Set<string>();
  for (const c of cases as any[]) {
    if (!c || typeof c.id !== "string" || !c.id.trim()) {
      throw new Error(`malformed case (need non-empty id): ${JSON.stringify(c)?.slice(0, 140)}`);
    }
    if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    if (!Array.isArray(c.candidates) || c.candidates.length < 1) {
      throw new Error(`case ${c.id}: needs a non-empty candidates[]`);
    }
    const candSeen = new Set<string>();
    const candidates: MaintenanceCandidateSpec[] = c.candidates.map((cand: any) => {
      if (!cand || typeof cand.id !== "string" || !cand.id.trim() || typeof cand.text !== "string" || !cand.text.trim()) {
        throw new Error(`case ${c.id}: candidate needs non-empty id and text: ${JSON.stringify(cand)?.slice(0, 100)}`);
      }
      if (candSeen.has(cand.id)) throw new Error(`case ${c.id}: duplicate candidate id ${cand.id}`);
      candSeen.add(cand.id);
      if (cand.ageDays !== undefined && (typeof cand.ageDays !== "number" || !Number.isFinite(cand.ageDays) || cand.ageDays < 0)) {
        throw new Error(`case ${c.id}: candidate ${cand.id} ageDays must be a non-negative number`);
      }
      if (cand.supportingObservations !== undefined && (typeof cand.supportingObservations !== "number" || !Number.isFinite(cand.supportingObservations) || cand.supportingObservations < 0)) {
        throw new Error(`case ${c.id}: candidate ${cand.id} supportingObservations must be a non-negative number`);
      }
      if (cand.confidence !== undefined && typeof cand.confidence !== "number") {
        throw new Error(`case ${c.id}: candidate ${cand.id} confidence must be a number`);
      }
      return {
        id: cand.id,
        text: cand.text,
        ageDays: cand.ageDays,
        sourceAuthority: typeof cand.sourceAuthority === "string" ? cand.sourceAuthority : undefined,
        supportingObservations: cand.supportingObservations,
        confidence: cand.confidence !== undefined ? clamp01(cand.confidence) : undefined,
      };
    });

    const hasWinnerAssertion = typeof c.expectedWinnerId === "string" && c.expectedWinnerId.trim();
    const hasEscalateAssertion = typeof c.expectedEscalate === "boolean";
    if (!hasWinnerAssertion && !hasEscalateAssertion) {
      throw new Error(`case ${c.id}: must assert at least one of expectedWinnerId or expectedEscalate`);
    }
    if (hasWinnerAssertion && !candSeen.has(c.expectedWinnerId)) {
      throw new Error(`case ${c.id}: expectedWinnerId "${c.expectedWinnerId}" is not one of its candidate ids`);
    }

    seen.add(c.id);
    out.push({
      id: c.id,
      category: typeof c.category === "string" && c.category.trim() ? c.category : "uncategorized",
      candidates,
      expectedWinnerId: hasWinnerAssertion ? c.expectedWinnerId : undefined,
      expectedEscalate: hasEscalateAssertion ? c.expectedEscalate : undefined,
      note: typeof c.note === "string" ? c.note : undefined,
    });
  }
  return out;
}

/**
 * Grade one case's actual resolver outcome against its assertions. Deterministic:
 * a case passes only if EVERY asserted dimension (winner and/or escalate) matches.
 */
export function gradeMaintenanceCase(c: MaintenanceCase, actual: MaintenanceActual): { passed: boolean; mismatch?: string } {
  const mismatches: string[] = [];
  if (c.expectedWinnerId !== undefined && actual.winnerId !== c.expectedWinnerId) {
    mismatches.push(`winner expected "${c.expectedWinnerId}" got "${actual.winnerId ?? "none"}"`);
  }
  if (c.expectedEscalate !== undefined && actual.escalate !== c.expectedEscalate) {
    mismatches.push(`escalate expected ${c.expectedEscalate} got ${actual.escalate}`);
  }
  return mismatches.length === 0 ? { passed: true } : { passed: false, mismatch: mismatches.join("; ") };
}

export interface MaintenanceVerdictInput {
  totalCases: number;
  executedCases: number;
  passedCases: number;
  /** min fraction of cases that must EXECUTE without error (default 1.0 — deterministic). */
  minCoverage: number;
  /** min fraction of EXECUTED cases that must PASS (default 1.0). */
  passFloor: number;
}

export interface MaintenanceVerdict {
  coverage: number;
  passRate: number;
  degraded: boolean;
  failed: boolean;
  /** 0 pass · 2 logic regression (a case mismatched) · 3 degraded coverage */
  exitCode: 0 | 2 | 3;
}

/**
 * Decide the run outcome. Coverage is checked FIRST and fails CLOSED: if cases
 * could not even execute, the run is DEGRADED (exit 3) and is never ALSO reported
 * as a pass/fail off an untrustworthy partial run (same ordering invariant as
 * offline-eval-core.computeVerdict — memory audit-fail-closed-coverage).
 */
export function computeMaintenanceVerdict(input: MaintenanceVerdictInput): MaintenanceVerdict {
  const coverage = input.totalCases > 0 ? input.executedCases / input.totalCases : 0;
  const passRate = input.executedCases > 0 ? input.passedCases / input.executedCases : 0;
  const minCoverage = clamp01(input.minCoverage);
  const passFloor = clamp01(input.passFloor);

  const degraded = coverage < minCoverage;
  const failed = !degraded && passRate < passFloor;
  const exitCode: 0 | 2 | 3 = degraded ? 3 : failed ? 2 : 0;
  return { coverage, passRate, degraded, failed, exitCode };
}
