/**
 * Proof levels (L1–L5) — an explicit, per-run rigor knob adapted from the
 * PROOF_LOOPS architecture (Boucher, Montreal.AI 2026, evaluated 2026-07-11).
 *
 * The platform already calibrates gate strictness PER SURFACE (persona
 * safety_profile, destructive-tool policy class, deliverable contracts). This
 * module adds the missing PER-RUN axis: a single declared level that jointly
 * tunes Evidence Docket strictness and states which proof obligations a run
 * of that rigor must satisfy.
 *
 * Design invariants (non-negotiable):
 *  - ADVISORY + FAIL-OPEN. A proof level NEVER blocks execution, never relaxes
 *    a safety check, and never bypasses the intent gate / tool policy (those
 *    fail closed independently). It only changes what the Evidence Docket
 *    demands as evidence and how loudly it reports gaps ("proof debt").
 *  - Backward compatible. The default level (L2) imposes NO obligations beyond
 *    today's behavior — omitting the knob changes nothing.
 *  - PURE module: no DB, no I/O, no imports beyond types. Safe for unit tests.
 */

export type ProofLevel = "L1" | "L2" | "L3" | "L4" | "L5";

export interface ProofLevelPolicy {
  level: ProofLevel;
  name: string;
  /** Per-section Evidence Docket row cap (higher rigor scans more history). */
  docketMaxRows: number;
  /** L3+: the docket flags proof debt when NO completion-verification rows exist. */
  requireVerification: boolean;
  /** L4+: the docket flags proof debt when no step-ledger replay pointer (runId) was supplied. */
  requireReplay: boolean;
  /** L5: the docket flags proof debt when no jury concordance rows exist in the window. */
  requireJury: boolean;
  /** Advisory memory-effect posture (PROOF_LOOPS Table 1) — descriptive only. */
  memoryEffect: string;
}

export const DEFAULT_PROOF_LEVEL: ProofLevel = "L2";

const POLICIES: Record<ProofLevel, ProofLevelPolicy> = {
  L1: {
    level: "L1",
    name: "Structural / Demo",
    docketMaxRows: 25,
    requireVerification: false,
    requireReplay: false,
    requireJury: false,
    memoryEffect: "No durable memory influence — exploratory draft.",
  },
  L2: {
    level: "L2",
    name: "Internal Review",
    docketMaxRows: 50,
    requireVerification: false,
    requireReplay: false,
    requireJury: false,
    memoryEffect: "Temporary reuse, clearly labeled — operator-confirmed usefulness.",
  },
  L3: {
    level: "L3",
    name: "External Review",
    docketMaxRows: 100,
    requireVerification: true,
    requireReplay: false,
    requireJury: false,
    memoryEffect: "Scoped reusable capability — independent verification expected.",
  },
  L4: {
    level: "L4",
    name: "Handoff",
    docketMaxRows: 150,
    requireVerification: true,
    requireReplay: true,
    requireJury: false,
    memoryEffect: "May inform external execution — validated evidence + replay path expected.",
  },
  L5: {
    level: "L5",
    name: "Chronicle / Formal",
    docketMaxRows: 200,
    requireVerification: true,
    requireReplay: true,
    requireJury: true,
    memoryEffect: "Durable future-mission influence — multi-validator evidence, replay, and concordance expected.",
  },
};

/** Parse arbitrary input into a ProofLevel. Accepts "L3", "l3", 3, "3". Fail-open: null on anything else. */
export function parseProofLevel(v: unknown): ProofLevel | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) {
    return `L${v}` as ProofLevel;
  }
  if (typeof v === "string") {
    const m = v.trim().toUpperCase().match(/^L?([1-5])$/);
    if (m) return `L${m[1]}` as ProofLevel;
  }
  return null;
}

export function resolveProofLevelPolicy(level: ProofLevel): ProofLevelPolicy {
  return POLICIES[level] ?? POLICIES[DEFAULT_PROOF_LEVEL];
}

/**
 * Compute the run's proof debt: the list of obligations the declared proof
 * level imposes that the gathered evidence does NOT satisfy. Purely
 * informational — surfaced in the docket so a reviewer sees exactly what is
 * still unproven at the declared rigor (PROOF_LOOPS §7: uncertainty becomes a
 * work queue, not prose).
 */
export function computeProofDebt(
  policy: ProofLevelPolicy,
  evidence: {
    verificationCount: number;
    failedVerificationCount: number;
    hasReplayPointer: boolean;
    juryRowCount: number;
  },
): string[] {
  const debt: string[] = [];
  if (policy.requireVerification && evidence.verificationCount === 0) {
    debt.push(
      `${policy.level} requires completion-verification evidence, but no verification rows exist for this work.`,
    );
  }
  if (evidence.failedVerificationCount > 0) {
    debt.push(
      `${evidence.failedVerificationCount} completion verification(s) FAILED — failed claims cannot be reused at any proof level.`,
    );
  }
  if (policy.requireReplay && !evidence.hasReplayPointer) {
    debt.push(
      `${policy.level} requires a step-ledger replay pointer (runId), but none was supplied — the result cannot be reconstructed.`,
    );
  }
  if (policy.requireJury && evidence.juryRowCount === 0) {
    debt.push(
      `${policy.level} requires multi-validator (jury concordance) evidence, but no jury rows exist in the audit window.`,
    );
  }
  return debt;
}
