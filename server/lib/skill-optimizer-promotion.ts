/**
 * Durable, fail-closed promotion boundary for SkillOpt candidates.
 *
 * The optimizer and jury may propose a document, but only this module may turn
 * that proposal into a live skills.prompt_content update. Filesystem artifacts
 * are evidence, never authorization. The skills catalog is platform-global, so
 * all optimizer rows must use ADMIN_TENANT_ID.
 */

import { createHash, createHmac } from "node:crypto";
import {
  scanManagedSkillPromptSafety,
  type ManagedSkillPromptCandidate,
} from "./managed-skill-safety";

export const SKILL_OPT_PROMOTION_ENABLED = "SKILL_OPT_PROMOTION_ENABLED";
export const SKILL_OPT_HOLD_DAYS = 7;
export const SKILL_OPT_POLICY_VERSION = "skillopt-promotion-v1";

export type SkillOptimizationCandidateState =
  | "proposed"
  | "approved"
  | "promoted"
  | "rejected"
  | "held"
  | "failed"
  | "rolled_back";

export type SkillOptimizationSource = "nightly" | "manual";

export interface SkillOptimizationJuryDecision {
  verdict: string;
  majority: number;
  shouldEscalate?: boolean;
  concordance?: number | null;
  votes?: unknown[];
  aggregatorAnswer?: string;
}

export interface CandidateIdentityInput {
  tenantId: number;
  skillId: number | null;
  label: string;
  seedHash: string;
  candidateHash: string;
  evalSetHash: string;
  policyVersion?: string;
  source?: SkillOptimizationSource;
}

export interface PromotionGateInput {
  tenantId: number;
  adminTenantId: number;
  state: string;
  identityKey: string;
  expectedIdentityKey: string;
  policyVersion: string;
  expectedPolicyVersion: string;
  candidateHash: string;
  storedCandidateHash: string;
  seedHash: string;
  evalSetHash: string;
  currentSkillHash: string;
  juryDecision: SkillOptimizationJuryDecision | null;
  juryDecisionHash: string | null;
  expectedJuryDecisionHash: string;
  evidence: unknown;
  promotionEnabled: boolean;
  dryRun: boolean;
}

export interface PromotionGateResult {
  ok: boolean;
  reason?: string;
}

export interface RegisterCandidateInput {
  tenantId: number;
  skillId: number | null;
  label: string;
  seedContent: string;
  candidateContent: string;
  evalSetHash: string;
  evidence?: Record<string, unknown>;
  source: SkillOptimizationSource;
  name?: string;
  description?: string;
}

export interface RegisterCandidateResult {
  id: number;
  state: SkillOptimizationCandidateState;
  candidateHash: string;
  seedHash: string;
  identityKey: string;
  detail?: string;
}

export interface PromotionResult {
  ok: boolean;
  state: SkillOptimizationCandidateState | "refused";
  detail: string;
  previousVersionId?: number;
  promotedVersionId?: number;
}

function requirePositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`skill optimizer: ${label} must be a positive integer`);
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableSerialize(record[key])}`,
  ).join(",")}}`;
}

export function buildJuryDecisionHash(input: {
  tenantId: number;
  skillId: number | null;
  seedHash: string;
  candidateHash: string;
  policyVersion: string;
  evidenceHash: string;
  decision: unknown;
}): string {
  const signingKey = process.env.SESSION_SECRET;
  if (!signingKey || signingKey.length < 32) {
    throw new Error("skill optimizer: jury approval signing key is unavailable");
  }
  return createHmac("sha256", signingKey).update(stableSerialize(input), "utf8").digest("hex");
}

export function buildCandidateIdentity(input: CandidateIdentityInput): string {
  requirePositiveInt(input.tenantId, "tenantId");
  if (input.skillId !== null) requirePositiveInt(input.skillId, "skillId");
  return sha256(JSON.stringify({
    tenantId: input.tenantId,
    skillId: input.skillId,
    label: input.label,
    seedHash: input.seedHash,
    candidateHash: input.candidateHash,
    evalSetHash: input.evalSetHash,
    policyVersion: input.policyVersion || SKILL_OPT_POLICY_VERSION,
    source: input.source || "optimizer",
  }));
}

export interface CandidateEvidenceValidation {
  ok: boolean;
  reason?: string;
}

export function validateCandidateEvidence(
  evidence: unknown,
  expected?: {
    seedHash: string;
    candidateHash: string;
    evalSetHash: string;
    policyVersion: string;
  },
): CandidateEvidenceValidation {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, reason: "candidate evaluator evidence is missing or malformed" };
  }
  const record = evidence as Record<string, unknown>;
  const attestation = record.evaluationAttestation;
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    return { ok: false, reason: "candidate evaluator attestation is missing or malformed" };
  }
  const evaluation = attestation as Record<string, unknown>;
  const baseline = evaluation.baselineScore;
  const best = evaluation.bestScore;
  if (typeof baseline !== "number" || !Number.isFinite(baseline) ||
      typeof best !== "number" || !Number.isFinite(best)) {
    return { ok: false, reason: "candidate evaluator evidence needs finite baselineScore and bestScore" };
  }
  if (baseline < 0 || baseline > 1 || best < 0 || best > 1) {
    return { ok: false, reason: "candidate evaluator scores must be within 0..1" };
  }
  if (best <= baseline) {
    return { ok: false, reason: "candidate evaluator evidence is not a strict improvement" };
  }
  if (!Number.isInteger(evaluation.acceptedEdits) || Number(evaluation.acceptedEdits) < 1 ||
      !Number.isInteger(evaluation.rejectedEdits) || Number(evaluation.rejectedEdits) < 0) {
    return { ok: false, reason: "candidate evaluator edit counts are missing or malformed" };
  }
  if (expected && (
    evaluation.seedHash !== expected.seedHash ||
    evaluation.candidateHash !== expected.candidateHash ||
    evaluation.evalSetHash !== expected.evalSetHash ||
    evaluation.policyVersion !== expected.policyVersion
  )) {
    return { ok: false, reason: "candidate evaluator attestation is not bound to this candidate and policy" };
  }
  return { ok: true };
}

export function holdDeadline(from = new Date()): Date {
  return new Date(from.getTime() + SKILL_OPT_HOLD_DAYS * 24 * 60 * 60 * 1000);
}

export function isPromotionEnabled(): boolean {
  return process.env[SKILL_OPT_PROMOTION_ENABLED] === "1" &&
    process.env.SKILL_OPT_DRY_RUN !== "1";
}

export function validatePromotionGate(input: PromotionGateInput): PromotionGateResult {
  if (input.tenantId !== input.adminTenantId) {
    return { ok: false, reason: "optimizer skills are platform-global and require the admin tenant" };
  }
  if (input.state !== "approved") return { ok: false, reason: `candidate state is ${input.state}, not approved` };
  if (!input.identityKey || input.identityKey !== input.expectedIdentityKey) {
    return { ok: false, reason: "candidate identity does not match the reviewed record" };
  }
  if (!input.policyVersion || input.policyVersion !== input.expectedPolicyVersion) {
    return { ok: false, reason: "candidate validator policy version is stale or mismatched" };
  }
  if (!input.candidateHash || input.candidateHash !== input.storedCandidateHash) {
    return { ok: false, reason: "candidate hash does not match the reviewed candidate" };
  }
  if (!input.seedHash || input.seedHash !== input.currentSkillHash) {
    return { ok: false, reason: "seed hash does not match the current live skill" };
  }
  const jury = input.juryDecision;
  if (!jury || jury.shouldEscalate || jury.verdict !== "FIX" || jury.majority !== 2) {
    return { ok: false, reason: "candidate lacks an exact 2-of-3 FIX jury approval" };
  }
  if (!input.juryDecisionHash || input.juryDecisionHash !== input.expectedJuryDecisionHash) {
    return { ok: false, reason: "jury approval is not bound to this candidate, seed, and policy" };
  }
  const evidence = validateCandidateEvidence(input.evidence, {
    seedHash: input.seedHash,
    candidateHash: input.candidateHash,
    evalSetHash: input.evalSetHash,
    policyVersion: input.policyVersion,
  });
  if (!evidence.ok) return evidence;
  if (!input.promotionEnabled) return { ok: false, reason: "skill optimizer promotion kill switch is off" };
  if (input.dryRun) return { ok: false, reason: "skill optimizer dry-run is enabled" };
  return { ok: true };
}

function promptCandidate(name: string, description: string, content: string): ManagedSkillPromptCandidate {
  return { name, description, promptContent: content };
}

async function loadPromotionDb() {
  const [{ db, withTenantTx }, schema, { eq, and, lte, sql }] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
    import("drizzle-orm"),
  ]);
  return { db, withTenantTx, schema, eq, and, lte, sql };
}

export async function registerSkillOptimizationCandidate(
  input: RegisterCandidateInput,
): Promise<RegisterCandidateResult> {
  requirePositiveInt(input.tenantId, "tenantId");
  if (input.skillId !== null) requirePositiveInt(input.skillId, "skillId");
  if (!input.label.trim()) throw new Error("skill optimizer: candidate label is required");
  if (!input.seedContent.trim() || !input.candidateContent.trim()) {
    throw new Error("skill optimizer: seed and candidate content are required");
  }

  const seedHash = sha256(input.seedContent);
  const candidateHash = sha256(input.candidateContent);
  const identityKey = buildCandidateIdentity({
    tenantId: input.tenantId,
    skillId: input.skillId,
    label: input.label,
    seedHash,
    candidateHash,
    evalSetHash: input.evalSetHash,
    source: input.source,
  });

  const registrationScan = scanManagedSkillPromptSafety(promptCandidate(
    input.name || input.label,
    input.description || "Optimizer candidate under review",
    input.candidateContent,
  ));
  const unsafeReason = registrationScan.safe
    ? undefined
    : `Managed skill content rejected by security scan (${registrationScan.patterns.join(", ") || "unsafe-content"})`;

  const state: SkillOptimizationCandidateState = unsafeReason ? "rejected" : "proposed";
  const { withTenantTx, schema, eq, and } = await loadPromotionDb();
  const row = await withTenantTx(input.tenantId, async (tx) => {
    const [inserted] = await tx.insert(schema.skillOptimizationCandidates).values({
      tenantId: input.tenantId,
      skillId: input.skillId,
      label: input.label,
      identityKey,
      seedHash,
      candidateHash,
      evalSetHash: input.evalSetHash,
      policyVersion: SKILL_OPT_POLICY_VERSION,
      name: input.name || null,
      description: input.description || null,
      candidateContent: unsafeReason ? null : input.candidateContent,
      state,
      source: input.source,
      evidence: {
        ...(input.evidence || {}),
        evaluationAttestation: {
          seedHash,
          candidateHash,
          evalSetHash: input.evalSetHash,
          policyVersion: SKILL_OPT_POLICY_VERSION,
          baselineScore: input.evidence?.baselineScore,
          bestScore: input.evidence?.bestScore,
          acceptedEdits: input.evidence?.acceptedEdits,
          rejectedEdits: input.evidence?.rejectedEdits,
        },
        registrationValidation: {
          policyVersion: SKILL_OPT_POLICY_VERSION,
          candidateHash,
          safe: registrationScan.safe,
          findings: registrationScan.findings,
        },
      },
      failureReason: unsafeReason || null,
      updatedAt: new Date(),
    }).onConflictDoNothing({
      target: [
        schema.skillOptimizationCandidates.tenantId,
        schema.skillOptimizationCandidates.identityKey,
      ],
    }).returning();
    if (inserted) return inserted;
    const [existing] = await tx
      .select()
      .from(schema.skillOptimizationCandidates)
      .where(and(
        eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
        eq(schema.skillOptimizationCandidates.identityKey, identityKey),
      ))
      .limit(1);
    if (!existing) throw new Error("skill optimizer: candidate deduplication lost the canonical row");
    return existing;
  });
  return {
    id: row.id,
    state: row.state,
    candidateHash: row.candidateHash,
    seedHash: row.seedHash,
    identityKey: row.identityKey,
    detail: row.id && row.state !== state ? "existing candidate identity reused" : unsafeReason,
  };
}

export async function transitionSkillOptimizationCandidate(
  tenantId: number,
  candidateId: number,
  nextState: SkillOptimizationCandidateState,
  fields: {
    reason?: string;
    juryDecision?: SkillOptimizationJuryDecision;
    deadline?: Date | null;
    previousVersionId?: number | null;
    promotedVersionId?: number | null;
    juryDecisionHash?: string | null;
  } = {},
): Promise<boolean> {
  requirePositiveInt(tenantId, "tenantId");
  requirePositiveInt(candidateId, "candidateId");
  const { withTenantTx, schema, eq, and } = await loadPromotionDb();
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx
      .select({ state: schema.skillOptimizationCandidates.state })
      .from(schema.skillOptimizationCandidates)
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      ))
      .limit(1)
      .for("update");
    if (!rows[0]) return false;
    const current = String(rows[0].state);
    if (["promoted", "rejected", "failed", "rolled_back"].includes(current)) return false;
    const [updated] = await tx
      .update(schema.skillOptimizationCandidates)
      .set({
        state: nextState,
        failureReason: fields.reason || null,
        juryDecision: fields.juryDecision || undefined,
        juryDecisionHash: fields.juryDecisionHash === undefined ? undefined : fields.juryDecisionHash,
        reviewDeadline: fields.deadline === undefined ? undefined : fields.deadline,
        previousVersionId: fields.previousVersionId === undefined ? undefined : fields.previousVersionId,
        promotedVersionId: fields.promotedVersionId === undefined ? undefined : fields.promotedVersionId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
        eq(schema.skillOptimizationCandidates.state, current),
      ))
      .returning({ id: schema.skillOptimizationCandidates.id });
    return Boolean(updated);
  });
}

export async function recordSkillOptimizationJuryDecision(
  tenantId: number,
  candidateId: number,
  decision: SkillOptimizationJuryDecision,
  action: "apply" | "hold" | "reject" | "escalate",
): Promise<boolean> {
  requirePositiveInt(tenantId, "tenantId");
  requirePositiveInt(candidateId, "candidateId");
  const { db, schema, eq, and, sql } = await loadPromotionDb();
  // Approval is the one privileged candidate transition. The RLS application
  // role is blocked from manufacturing it by the migration trigger; this
  // sealed writer still carries explicit tenant predicates and an HMAC that
  // the promotion boundary independently verifies.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${String(tenantId)}, true)`);
    const [candidate] = await tx
      .select()
      .from(schema.skillOptimizationCandidates)
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      ))
      .limit(1)
      .for("update");
    if (!candidate ||
        candidate.juryDecisionHash ||
        ["promoted", "rejected", "failed", "rolled_back"].includes(String(candidate.state))) {
      return false;
    }
    const validDecision = decision && typeof decision === "object" &&
      typeof decision.verdict === "string" &&
      Number.isInteger(decision.majority) &&
      decision.majority >= 0 && decision.majority <= 3 &&
      (decision.shouldEscalate === undefined || typeof decision.shouldEscalate === "boolean");
    const evidenceValidation = validateCandidateEvidence(candidate.evidence, {
      seedHash: candidate.seedHash,
      candidateHash: candidate.candidateHash,
      evalSetHash: candidate.evalSetHash,
      policyVersion: candidate.policyVersion,
    });
    let nextState: SkillOptimizationCandidateState;
    let reason: string | undefined;
    let deadline: Date | null | undefined;
    if (!validDecision) {
      nextState = "failed";
      reason = "malformed jury decision cannot authorize a promotion";
    } else if (action === "apply") {
      if (!evidenceValidation.ok) {
        nextState = "failed";
        reason = evidenceValidation.reason;
      } else if (decision.shouldEscalate || decision.verdict !== "FIX" || decision.majority !== 2) {
        nextState = "failed";
        reason = "invalid apply action: jury did not provide an exact 2-of-3 FIX approval";
      } else {
        nextState = "approved";
        deadline = null;
      }
    } else if (action === "reject") {
      nextState = "rejected";
      reason = `jury rejected candidate (${decision.verdict}, ${decision.majority}/3)`;
    } else {
      nextState = "held";
      reason = action === "escalate"
        ? `jury escalation requires owner review (${decision.verdict}, ${decision.majority}/3)`
        : `jury decision held for explicit review (${decision.verdict}, ${decision.majority}/3)`;
      deadline = holdDeadline();
    }
    let juryDecisionHash: string | null = null;
    try {
      juryDecisionHash = buildJuryDecisionHash({
        tenantId,
        skillId: candidate.skillId,
        seedHash: candidate.seedHash,
        candidateHash: candidate.candidateHash,
        policyVersion: candidate.policyVersion,
        evidenceHash: sha256(stableSerialize(candidate.evidence)),
        decision,
      });
    } catch (error) {
      nextState = "failed";
      deadline = null;
      reason = error instanceof Error ? error.message : "jury approval signing failed";
    }
    const [updated] = await tx
      .update(schema.skillOptimizationCandidates)
      .set({
        state: nextState,
        failureReason: reason || null,
        juryDecision: decision,
        juryDecisionHash,
        reviewDeadline: deadline,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
        eq(schema.skillOptimizationCandidates.state, candidate.state),
      ))
      .returning({ id: schema.skillOptimizationCandidates.id });
    return Boolean(updated);
  });
}

export async function recordSkillOptimizationEvidence(
  tenantId: number,
  candidateId: number,
  evidencePatch: Record<string, unknown>,
  requiredState?: SkillOptimizationCandidateState,
): Promise<boolean> {
  requirePositiveInt(tenantId, "tenantId");
  requirePositiveInt(candidateId, "candidateId");
  const { withTenantTx, schema, eq, and } = await loadPromotionDb();
  return withTenantTx(tenantId, async (tx) => {
    const [candidate] = await tx
      .select({
        evidence: schema.skillOptimizationCandidates.evidence,
        state: schema.skillOptimizationCandidates.state,
      })
      .from(schema.skillOptimizationCandidates)
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      ))
      .limit(1)
      .for("update");
    if (!candidate) return false;
    if (requiredState && candidate.state !== requiredState) return false;
    const current = candidate.evidence && typeof candidate.evidence === "object"
      ? candidate.evidence as Record<string, unknown>
      : {};
    const [updated] = await tx.update(schema.skillOptimizationCandidates).set({
      evidence: { ...current, ...evidencePatch },
      updatedAt: new Date(),
    }).where(and(
      eq(schema.skillOptimizationCandidates.id, candidateId),
      eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      eq(schema.skillOptimizationCandidates.state, candidate.state),
    )).returning({ id: schema.skillOptimizationCandidates.id });
    return Boolean(updated);
  });
}

export async function finalizeSkillOptimizationVerification(input: {
  tenantId: number;
  candidateId: number;
  passed: boolean;
  evidence: Record<string, unknown>;
}): Promise<PromotionResult> {
  if (input.passed) {
    try {
      const recorded = await recordSkillOptimizationEvidence(
        input.tenantId,
        input.candidateId,
        { postPromotionVerification: input.evidence },
        "promoted",
      );
      if (!recorded) throw new Error("candidate disappeared before verification evidence persisted");
      return { ok: true, state: "promoted", detail: "post-promotion verification passed and persisted" };
    } catch (error) {
      const rollback = await rollbackSkillOptimizationCandidate(input.tenantId, input.candidateId);
      const detail = error instanceof Error ? error.message : String(error);
      await recordSkillOptimizationEvidence(input.tenantId, input.candidateId, {
        postPromotionVerification: {
          ...input.evidence,
          ok: false,
          evidencePersistenceError: detail,
          rollback: rollback.state,
        },
      }).catch((recordError) => {
        console.error("[skill-optimizer-promotion] verification failure evidence could not persist:", recordError);
      });
      return {
        ok: false,
        state: rollback.ok ? "rolled_back" : "failed",
        detail: `verification evidence persistence failed; rollback=${rollback.state}: ${detail}`,
      };
    }
  }

  // Roll back before any secondary evidence write. Logging/storage failure must
  // never prevent removal of a candidate that failed verification.
  const rollback = await rollbackSkillOptimizationCandidate(input.tenantId, input.candidateId);
  let evidenceError: string | undefined;
  try {
    const recorded = await recordSkillOptimizationEvidence(
      input.tenantId,
      input.candidateId,
      {
        postPromotionVerification: {
          ...input.evidence,
          ok: false,
          rollback: rollback.state,
        },
      },
    );
    if (!recorded) evidenceError = "candidate disappeared before failure evidence persisted";
  } catch (error) {
    evidenceError = error instanceof Error ? error.message : String(error);
  }
  return {
    ok: false,
    state: rollback.ok ? "rolled_back" : "failed",
    detail:
      `post-promotion verification failed; rollback=${rollback.state}` +
      (evidenceError ? `; evidence persistence failed: ${evidenceError}` : ""),
  };
}

export async function promoteSkillOptimizationCandidate(input: {
  tenantId: number;
  candidateId: number;
  dryRun?: boolean;
}): Promise<PromotionResult> {
  requirePositiveInt(input.tenantId, "tenantId");
  requirePositiveInt(input.candidateId, "candidateId");
  const { withTenantTx, schema, eq, and } = await loadPromotionDb();
  const { ADMIN_TENANT_ID } = await import("../tenant-constants");

  if (!isPromotionEnabled() || input.dryRun) {
    const reason = input.dryRun
      ? "skill optimizer dry-run is enabled"
      : "skill optimizer promotion kill switch is off";
    const held = await transitionSkillOptimizationCandidate(input.tenantId, input.candidateId, "held", {
      reason,
      deadline: holdDeadline(),
    });
    return {
      ok: false,
      state: held ? "held" : "refused",
      detail: reason,
    };
  }
  if (process.env.NODE_ENV === "production") {
    const failed = await transitionSkillOptimizationCandidate(input.tenantId, input.candidateId, "failed", {
      reason: "optimizer promotion is refused in production runtime",
    });
    return {
      ok: false,
      state: failed ? "failed" : "refused",
      detail: "optimizer promotion is refused in production runtime",
    };
  }

  try {
    return await withTenantTx(input.tenantId, async (tx) => {
    const [candidate] = await tx
      .select()
      .from(schema.skillOptimizationCandidates)
      .where(and(
        eq(schema.skillOptimizationCandidates.id, input.candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
      ))
      .limit(1)
      .for("update");
    if (!candidate) return { ok: false, state: "refused" as const, detail: "candidate not found in tenant scope" };
    const failCandidate = async (detail: string) => {
      await tx.update(schema.skillOptimizationCandidates).set({
        state: "failed",
        failureReason: detail,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.skillOptimizationCandidates.id, candidate.id),
        eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
        eq(schema.skillOptimizationCandidates.state, candidate.state),
      ));
      return { ok: false, state: "failed" as const, detail };
    };
    if (candidate.tenantId !== ADMIN_TENANT_ID) {
      return failCandidate("optimizer skills require the admin tenant");
    }
    if (!candidate.candidateContent || !candidate.skillId) {
      return failCandidate("candidate has no promotable DB skill target/content");
    }

    const [skill] = await tx
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, candidate.skillId))
      .limit(1)
      .for("update");
    if (!skill || !skill.promptContent) {
      return failCandidate("live skill or seed prompt no longer exists");
    }

    const gate = validatePromotionGate({
      tenantId: candidate.tenantId,
      adminTenantId: ADMIN_TENANT_ID,
      state: candidate.state,
      identityKey: candidate.identityKey,
      expectedIdentityKey: buildCandidateIdentity({
        tenantId: candidate.tenantId,
        skillId: candidate.skillId,
        label: candidate.label,
        seedHash: candidate.seedHash,
        candidateHash: candidate.candidateHash,
        evalSetHash: candidate.evalSetHash,
        policyVersion: candidate.policyVersion,
        source: candidate.source as SkillOptimizationSource,
      }),
      policyVersion: candidate.policyVersion,
      expectedPolicyVersion: SKILL_OPT_POLICY_VERSION,
      candidateHash: candidate.candidateHash,
      storedCandidateHash: sha256(candidate.candidateContent),
      seedHash: candidate.seedHash,
      evalSetHash: candidate.evalSetHash,
      currentSkillHash: sha256(skill.promptContent),
      juryDecision: candidate.juryDecision as SkillOptimizationJuryDecision | null,
      juryDecisionHash: candidate.juryDecisionHash,
      expectedJuryDecisionHash: buildJuryDecisionHash({
        tenantId: candidate.tenantId,
        skillId: skill.id,
        seedHash: candidate.seedHash,
        candidateHash: candidate.candidateHash,
        policyVersion: candidate.policyVersion,
        evidenceHash: sha256(stableSerialize(candidate.evidence)),
        decision: candidate.juryDecision,
      }),
      evidence: candidate.evidence,
      promotionEnabled: true,
      dryRun: false,
    });
    if (!gate.ok) {
      await tx.update(schema.skillOptimizationCandidates).set({
        state: "failed",
        failureReason: gate.reason,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.skillOptimizationCandidates.id, candidate.id),
        eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
        eq(schema.skillOptimizationCandidates.state, candidate.state),
      ));
      return { ok: false, state: "failed" as const, detail: gate.reason || "promotion gate refused candidate" };
    }

    const promotionScan = scanManagedSkillPromptSafety(
      promptCandidate(skill.name, skill.description, candidate.candidateContent),
    );
    if (!promotionScan.safe) {
      const detail =
        `Managed skill content rejected by security scan (${promotionScan.patterns.join(", ") || "unsafe-content"})`;
      await tx.update(schema.skillOptimizationCandidates).set({
        state: "rejected",
        failureReason: detail,
        evidence: {
          ...(candidate.evidence && typeof candidate.evidence === "object" ? candidate.evidence : {}),
          promotionValidation: {
            policyVersion: SKILL_OPT_POLICY_VERSION,
            candidateHash: candidate.candidateHash,
            safe: false,
            findings: promotionScan.findings,
          },
        },
        updatedAt: new Date(),
      }).where(and(
        eq(schema.skillOptimizationCandidates.id, candidate.id),
        eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
      ));
      return { ok: false, state: "rejected" as const, detail };
    }
    const [validationRecorded] = await tx.update(schema.skillOptimizationCandidates).set({
      evidence: {
        ...(candidate.evidence && typeof candidate.evidence === "object" ? candidate.evidence : {}),
        promotionValidation: {
          policyVersion: SKILL_OPT_POLICY_VERSION,
          candidateHash: candidate.candidateHash,
          safe: true,
          findings: promotionScan.findings,
        },
      },
      updatedAt: new Date(),
    }).where(and(
      eq(schema.skillOptimizationCandidates.id, candidate.id),
      eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
      eq(schema.skillOptimizationCandidates.state, "approved"),
    )).returning({ id: schema.skillOptimizationCandidates.id });
    if (!validationRecorded) {
      throw new Error("promotion validation evidence could not be bound to the approved candidate");
    }

    const [previous] = await tx.insert(schema.skillOptimizationVersions).values({
      tenantId: candidate.tenantId,
      skillId: skill.id,
      candidateId: candidate.id,
      content: skill.promptContent,
      contentHash: sha256(skill.promptContent),
      kind: "pre-promotion",
    }).returning({ id: schema.skillOptimizationVersions.id });

    const [updatedSkill] = await tx
      .update(schema.skills)
      .set({ promptContent: candidate.candidateContent })
      .where(and(
        eq(schema.skills.id, skill.id),
        eq(schema.skills.promptContent, skill.promptContent),
      ))
      .returning({ id: schema.skills.id });
    if (!updatedSkill) {
      throw new Error("live skill changed during compare-and-swap");
    }

    const [promoted] = await tx.insert(schema.skillOptimizationVersions).values({
      tenantId: candidate.tenantId,
      skillId: skill.id,
      candidateId: candidate.id,
      content: candidate.candidateContent,
      contentHash: candidate.candidateHash,
      kind: "promotion",
      previousVersionId: previous.id,
    }).returning({ id: schema.skillOptimizationVersions.id });

    const [updatedCandidate] = await tx
      .update(schema.skillOptimizationCandidates)
      .set({
        state: "promoted",
        promotedAt: new Date(),
        previousVersionId: previous.id,
        promotedVersionId: promoted.id,
        failureReason: null,
        reviewDeadline: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidate.id),
        eq(schema.skillOptimizationCandidates.tenantId, input.tenantId),
        eq(schema.skillOptimizationCandidates.state, "approved"),
        eq(schema.skillOptimizationCandidates.candidateHash, candidate.candidateHash),
      ))
      .returning({ id: schema.skillOptimizationCandidates.id });
    if (!updatedCandidate) {
      throw new Error("candidate approval changed during promotion");
    }
    return {
      ok: true,
      state: "promoted" as const,
      detail: `promoted skill ${skill.id}`,
      previousVersionId: previous.id,
      promotedVersionId: promoted.id,
    };
    });
  } catch (error) {
    console.error("[skill-optimizer-promotion] promotion transaction failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    await transitionSkillOptimizationCandidate(input.tenantId, input.candidateId, "failed", {
      reason: `promotion transaction failed: ${detail}`,
    }).catch((transitionError) => {
      console.error("[skill-optimizer-promotion] failed to persist promotion failure:", transitionError);
    });
    return { ok: false, state: "failed", detail: `promotion transaction failed: ${detail}` };
  }
}

export async function rollbackSkillOptimizationCandidate(
  tenantId: number,
  candidateId: number,
): Promise<PromotionResult> {
  const { withTenantTx, schema, eq, and } = await loadPromotionDb();
  return withTenantTx(tenantId, async (tx) => {
    const [candidate] = await tx
      .select()
      .from(schema.skillOptimizationCandidates)
      .where(and(
        eq(schema.skillOptimizationCandidates.id, candidateId),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      ))
      .limit(1)
      .for("update");
    if (!candidate || candidate.state !== "promoted" || !candidate.previousVersionId) {
      return { ok: false, state: "refused" as const, detail: "candidate is not an active promotion" };
    }
    const [previous] = await tx
      .select()
      .from(schema.skillOptimizationVersions)
      .where(and(
        eq(schema.skillOptimizationVersions.id, candidate.previousVersionId),
        eq(schema.skillOptimizationVersions.tenantId, tenantId),
        eq(schema.skillOptimizationVersions.skillId, candidate.skillId),
        eq(schema.skillOptimizationVersions.candidateId, candidate.id),
        eq(schema.skillOptimizationVersions.kind, "pre-promotion"),
        eq(schema.skillOptimizationVersions.contentHash, candidate.seedHash),
      ))
      .limit(1);
    const [skill] = await tx
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.id, candidate.skillId))
      .limit(1)
      .for("update");
    if (!previous || !skill || !skill.promptContent || sha256(skill.promptContent) !== candidate.candidateHash) {
      await tx.update(schema.skillOptimizationCandidates).set({
        state: "failed",
        failureReason: "rollback conflict: live skill no longer matches this promotion",
        updatedAt: new Date(),
      }).where(and(
        eq(schema.skillOptimizationCandidates.id, candidate.id),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
        eq(schema.skillOptimizationCandidates.state, "promoted"),
      ));
      return { ok: false, state: "failed" as const, detail: "rollback conflict: live skill changed after promotion" };
    }
    const [restored] = await tx.update(schema.skills).set({
      promptContent: previous.content,
    }).where(and(
      eq(schema.skills.id, skill.id),
      eq(schema.skills.promptContent, skill.promptContent),
    )).returning({ id: schema.skills.id });
    if (!restored) {
      await tx.update(schema.skillOptimizationCandidates).set({
        state: "failed",
        failureReason: "rollback compare-and-swap refused",
        updatedAt: new Date(),
      }).where(and(
        eq(schema.skillOptimizationCandidates.id, candidate.id),
        eq(schema.skillOptimizationCandidates.tenantId, tenantId),
        eq(schema.skillOptimizationCandidates.state, "promoted"),
      ));
      return { ok: false, state: "failed" as const, detail: "rollback compare-and-swap refused" };
    }
    const [rollbackVersion] = await tx.insert(schema.skillOptimizationVersions).values({
      tenantId,
      skillId: skill.id,
      candidateId: candidate.id,
      content: previous.content,
      contentHash: previous.contentHash,
      kind: "rollback",
      previousVersionId: candidate.promotedVersionId,
    }).returning({ id: schema.skillOptimizationVersions.id });
    const [updatedCandidate] = await tx.update(schema.skillOptimizationCandidates).set({
      state: "rolled_back",
      failureReason: "explicit rollback completed",
      rolledBackAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(schema.skillOptimizationCandidates.id, candidate.id),
      eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      eq(schema.skillOptimizationCandidates.state, "promoted"),
    )).returning({ id: schema.skillOptimizationCandidates.id });
    if (!updatedCandidate) {
      throw new Error("rollback lifecycle state was not persisted");
    }
    return { ok: true, state: "rolled_back" as const, detail: "promotion rolled back", promotedVersionId: rollbackVersion.id };
  });
}

export async function expireHeldSkillOptimizationCandidates(tenantId: number): Promise<number> {
  const { withTenantTx, schema, eq, and, lte } = await loadPromotionDb();
  const result = await withTenantTx(tenantId, async (tx) => {
    return tx.update(schema.skillOptimizationCandidates).set({
      state: "rejected",
      failureReason: "owner review deadline expired without an explicit decision",
      reviewDeadline: null,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.skillOptimizationCandidates.tenantId, tenantId),
      eq(schema.skillOptimizationCandidates.state, "held"),
      lte(schema.skillOptimizationCandidates.reviewDeadline, new Date()),
    )).returning({ id: schema.skillOptimizationCandidates.id });
  });
  return result.length;
}