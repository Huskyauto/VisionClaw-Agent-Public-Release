/**
 * Guarded production-shadow adapter for reasoned candidate review.
 *
 * This module is deliberately separate from delivery and selection policy:
 * shadow review is advisory, the legacy/baseline selector remains authoritative,
 * and the narrow canary can only return a candidate when every independent
 * evidence gate passes. Customer content is held in memory for the bounded
 * reviewer call and is never written to the evidence row or a forensic file.
 */

import { createHash, createHmac } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { estimateCostUsd } from "../agentic/cost-ledger";
import { withTenantTx } from "../db";
import { runLlmTask } from "../llm-task";
import { reasonedReviewEvidence } from "@shared/schema";
import {
  runReasonedReviewTrial,
  type PositionBlindReviewInput,
  type ReasonedReviewer,
} from "./reasoned-review-trial";

export type ProductionReviewCandidate = {
  id: string;
  content: string;
  generatorModel?: string;
};

export type ProductionReviewInput = {
  tenantId: number;
  deliverableType: string;
  rubric: string;
  baselineCandidateId: string;
  candidates: ProductionReviewCandidate[];
  /** Stable caller-owned key; generated from hashes when omitted. */
  idempotencyKey?: string;
  provenance?: {
    source?: string;
    label?: string;
    benchmarkVersion?: string;
  };
  /** Only explicitly approved internal low-risk callers may set this. */
  canaryEligible?: boolean;
};

export type ProductionReviewMode = "shadow" | "canary";

export type ProductionReviewEvidence = {
  tenantId: number;
  deliverableType: string;
  mode: ProductionReviewMode;
  status: "reserved" | "complete";
  idempotencyKey: string;
  provenance: {
    source: string;
    label: string;
    benchmarkVersion: string;
    candidateCount: number;
    candidateHashes: string[];
    configuredReviewerModels: string[];
    reviewerModels: string[];
    reviewerFailureClasses: string[];
    reviewersIndependent: boolean;
  };
  baselineCandidateHash: string;
  recommendedCandidateHash: string | null;
  baselineDecision: "baseline";
  decisionUsed: "baseline" | "canary";
  degraded: boolean;
  disagreement: boolean;
  scoreMargin: number | null;
  estimatedCostUsd: number;
  latencyMs: number;
  fallbackReason: string | null;
  rollbackTriggered: boolean;
  validReviewerCount: number;
  actualReviewerModels: string[];
};

export type ProductionReviewResult = {
  enabled: boolean;
  mode: ProductionReviewMode | "disabled";
  decisionUsed: "baseline" | "canary";
  selectedCandidateId: string;
  recommendationCandidateId: string | null;
  scoreMargin: number | null;
  degraded: boolean;
  disagreement: boolean;
  estimatedCostUsd: number;
  latencyMs: number;
  fallbackReason?: string;
  rollbackTriggered: boolean;
  evidence?: ProductionReviewEvidence;
};

export type ProductionReviewDeps = {
  review?: (input: PositionBlindReviewInput, model: string) => Promise<{
    winnerPosition: number;
    scores: number[];
    critique: string;
    costUsd?: number;
    latencyMs?: number;
    actualModel?: string;
  }>;
  persist?: (evidence: ProductionReviewEvidence) => Promise<void>;
  reserve?: (evidence: ProductionReviewEvidence) => Promise<"reserved" | "duplicate" | "over_budget" | "rollback">;
  shouldRollback?: (evidence: ProductionReviewEvidence) => Promise<boolean>;
  now?: () => number;
};

const MAX_CANDIDATES = 4;
const MAX_RUBRIC_CHARS = 2_000;
const MAX_CANDIDATE_CHARS = 12_000;
const MAX_REVIEWERS = 2;
const MAX_REVIEW_COST_USD = 0.05;
const MAX_TENANT_DAILY_COST_USD = 0.25;
const MIN_CANARY_MARGIN = 8;
const CANARY_ROLLBACK_WINDOW = 10;
const CANARY_ROLLBACK_RATE = 0.5;
const CANARY_ROLLBACK_COOLDOWN_MS = 30 * 60 * 1000;
const RESERVATION_LEASE_MS = 2 * 60 * 1000;
const ALLOWED_REVIEWER_MODELS = new Set(["z-ai/glm-5.3-flash", "gpt-5-mini"]);
const DEFAULT_REVIEWER_MODELS = ["z-ai/glm-5.3-flash", "gpt-5-mini"];

/**
 * Held-out promotion contract. These are evidence requirements for a future
 * owner-approved rollout decision, not an activation switch and not a live
 * selection rule. The wider rollout remains disabled until an operator reviews
 * held-out evidence against every threshold.
 */
export const REASONED_REVIEW_PROMOTION_CRITERIA = {
  minimumHeldOutCases: 100,
  minimumQualityLift: 0.05,
  maximumDegradedRate: 0.05,
  maximumDisagreementRate: 0.1,
  maximumCanaryFallbackRate: 0.2,
  requiredAutomaticRollbackDrills: 1,
} as const;

type RuntimeEnv = Record<string, string | undefined>;

function listEnv(value: string | undefined): string[] {
  return [...new Set((value || "").split(",").map((part) => part.trim()).filter(Boolean))];
}

function parseReviewers(env: RuntimeEnv): string[] {
  const models = listEnv(env.REASONED_REVIEW_REVIEWER_MODELS);
  return models.length ? models : [...DEFAULT_REVIEWER_MODELS];
}

function allowlisted(value: string, allowlist: string[]): boolean {
  return allowlist.includes("*") || allowlist.includes(value);
}

function reviewerFailureClass(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  if (normalized.includes("parse") || normalized.includes("json") || normalized.includes("schema")) return "malformed_output";
  if (normalized.includes("refus")) return "refusal";
  return "execution_error";
}

function redactedError(error: unknown): { name: string; failureClass: string } {
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
    ? error.name
    : "UnknownError";
  const message = error instanceof Error ? error.message : "";
  return { name, failureClass: reviewerFailureClass(message) };
}

function controlsFor(input: ProductionReviewInput, env: RuntimeEnv = process.env): {
  mode: ProductionReviewMode | null;
  reviewers: string[];
  fallbackReason?: string;
} {
  if (env.REASONED_REVIEW_ENABLED === "0") return { mode: null, reviewers: [], fallbackReason: "global_kill_switch" };
  if (listEnv(env.REASONED_REVIEW_DISABLED_TENANTS).includes(String(input.tenantId))) {
    return { mode: null, reviewers: [], fallbackReason: "tenant_kill_switch" };
  }
  if (listEnv(env.REASONED_REVIEW_DISABLED_DELIVERABLES).includes(input.deliverableType)) {
    return { mode: null, reviewers: [], fallbackReason: "deliverable_kill_switch" };
  }

  const reviewers = parseReviewers(env);
  const shadowAllowed = env.REASONED_REVIEW_SHADOW_ENABLED === "1"
    && allowlisted(String(input.tenantId), listEnv(env.REASONED_REVIEW_SHADOW_TENANTS))
    && allowlisted(input.deliverableType, listEnv(env.REASONED_REVIEW_SHADOW_DELIVERABLES));
  const canaryAllowed = env.REASONED_REVIEW_CANARY_ENABLED === "1"
    && input.canaryEligible === true
    && allowlisted(String(input.tenantId), listEnv(env.REASONED_REVIEW_CANARY_TENANTS))
    && allowlisted(input.deliverableType, listEnv(env.REASONED_REVIEW_CANARY_DELIVERABLES));

  if (canaryAllowed) return { mode: "canary", reviewers };
  if (shadowAllowed) return { mode: "shadow", reviewers };
  return { mode: null, reviewers: [], fallbackReason: "not_allowlisted" };
}

export function isReasonedReviewCanaryActive(
  input: Pick<ProductionReviewInput, "tenantId" | "deliverableType" | "canaryEligible">,
  env: RuntimeEnv = process.env,
): boolean {
  return controlsFor({
    ...input,
    rubric: "",
    baselineCandidateId: "",
    candidates: [],
  }, env).mode === "canary";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function contentHash(value: string, tenantId: number): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("reasoned-review evidence hash key unavailable");
  return createHmac("sha256", key).update(`${tenantId}:${value}`).digest("hex").slice(0, 24);
}

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function makeIdempotencyKey(input: ProductionReviewInput, candidates: ProductionReviewCandidate[]): string {
  if (input.idempotencyKey?.trim()) return `reasoned-review:${hash(input.idempotencyKey.trim())}`;
  return `reasoned-review:${hash([
    input.tenantId,
    input.deliverableType,
    input.baselineCandidateId,
    ...candidates.map((candidate) => `${candidate.id}:${contentHash(candidate.content, input.tenantId)}`),
  ].join("|"))}`;
}

export function shouldTriggerAutomaticRollback(outcomes: Array<"baseline" | "canary">): boolean {
  const bounded = outcomes.slice(-CANARY_ROLLBACK_WINDOW);
  return bounded.length === CANARY_ROLLBACK_WINDOW
    && bounded.filter((outcome) => outcome === "baseline").length / bounded.length >= CANARY_ROLLBACK_RATE;
}

async function realReview(input: PositionBlindReviewInput, model: string): Promise<{
  winnerPosition: number;
  scores: number[];
  critique: string;
  costUsd: number;
  latencyMs: number;
  actualModel: string;
}> {
  const startedAt = Date.now();
  const prompt = [
    "You are an independent evaluator. Judge only the rubric and candidate text.",
    "Candidate positions are randomized. Return JSON only.",
    `RUBRIC:\n${input.rubric}`,
    "",
    "Return {\"winnerPosition\": integer, \"scores\": number[], \"critique\": string}.",
    ...input.candidates.map((candidate) => `POSITION ${candidate.position}:\n${candidate.content}`),
  ].join("\n");
  const result = await runLlmTask({
    model,
    tenantId: Number(input.caseId.split(":")[0]),
    prompt,
    maxTokens: 400,
    temperature: 0,
    timeoutMs: 8_000,
    requiresTools: false,
    maxPromptRepairs: 0,
    maxModels: 1,
  });
  if (!result.success || !result.json) throw new Error("reviewer unavailable");
  const usedModel = result.servedModel || result.model || model;
  return {
    winnerPosition: result.json.winnerPosition,
    scores: result.json.scores,
    critique: result.json.critique,
    costUsd: estimateCostUsd(usedModel, Math.ceil(prompt.length / 4), Math.ceil(JSON.stringify(result.json).length / 4)),
    latencyMs: result.durationMs || Date.now() - startedAt,
    actualModel: usedModel,
  };
}

async function writeEvidence(tx: any, evidence: ProductionReviewEvidence): Promise<void> {
  const values = {
    tenantId: evidence.tenantId,
    deliverableType: evidence.deliverableType,
    mode: evidence.mode,
    status: evidence.status,
    idempotencyKey: evidence.idempotencyKey,
    provenance: evidence.provenance,
    baselineCandidateHash: evidence.baselineCandidateHash,
    recommendedCandidateHash: evidence.recommendedCandidateHash,
    baselineDecision: evidence.baselineDecision,
    decisionUsed: evidence.decisionUsed,
    degraded: evidence.degraded,
    disagreement: evidence.disagreement,
    scoreMargin: evidence.scoreMargin,
    estimatedCostUsd: evidence.estimatedCostUsd,
    latencyMs: evidence.latencyMs,
    fallbackReason: evidence.fallbackReason,
    rollbackTriggered: evidence.rollbackTriggered,
    validReviewerCount: evidence.validReviewerCount,
    actualReviewerModels: evidence.actualReviewerModels,
  };
  await tx.insert(reasonedReviewEvidence)
    .values(values)
    .onConflictDoUpdate({
      target: [reasonedReviewEvidence.tenantId, reasonedReviewEvidence.idempotencyKey],
      set: {
        status: values.status,
        provenance: values.provenance,
        recommendedCandidateHash: values.recommendedCandidateHash,
        decisionUsed: values.decisionUsed,
        degraded: values.degraded,
        disagreement: values.disagreement,
        scoreMargin: values.scoreMargin,
        estimatedCostUsd: values.estimatedCostUsd,
        latencyMs: values.latencyMs,
        fallbackReason: values.fallbackReason,
        rollbackTriggered: values.rollbackTriggered,
        validReviewerCount: values.validReviewerCount,
        actualReviewerModels: values.actualReviewerModels,
      },
    });
}

async function persistProductionEvidence(evidence: ProductionReviewEvidence): Promise<void> {
  await withTenantTx(evidence.tenantId, (tx) => writeEvidence(tx, evidence));
}

async function reserveProductionEvidence(evidence: ProductionReviewEvidence): Promise<"reserved" | "duplicate" | "over_budget" | "rollback"> {
  return withTenantTx(evidence.tenantId, async (tx) => {
    // Serialize reservations for this tenant so concurrent workers cannot both
    // pass the daily ceiling or the same idempotency key.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(177, ${evidence.tenantId})`);
    const duplicate = await tx.select({
      id: reasonedReviewEvidence.id,
      status: reasonedReviewEvidence.status,
      createdAt: reasonedReviewEvidence.createdAt,
    })
      .from(reasonedReviewEvidence)
      .where(and(
        eq(reasonedReviewEvidence.tenantId, evidence.tenantId),
        eq(reasonedReviewEvidence.idempotencyKey, evidence.idempotencyKey),
      ))
      .limit(1);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const rows = await tx.select({
      total: sql<number>`COALESCE(SUM(${reasonedReviewEvidence.estimatedCostUsd}), 0)`,
    })
      .from(reasonedReviewEvidence)
      .where(and(
        eq(reasonedReviewEvidence.tenantId, evidence.tenantId),
        gte(reasonedReviewEvidence.createdAt, startOfDay),
      ));
    const spent = Number(rows[0]?.total || 0);
    if (!Number.isFinite(spent)) return "over_budget";
    if (duplicate.length) {
      const existing = duplicate[0];
      if (existing.status === "reserved"
          && existing.createdAt.getTime() < Date.now() - RESERVATION_LEASE_MS) {
        if (spent + evidence.estimatedCostUsd > MAX_TENANT_DAILY_COST_USD) return "over_budget";
        await tx.update(reasonedReviewEvidence)
          .set({
            createdAt: new Date(),
            provenance: evidence.provenance,
            estimatedCostUsd: sql`${reasonedReviewEvidence.estimatedCostUsd} + ${evidence.estimatedCostUsd}`,
            fallbackReason: "review_reserved_recovered",
          })
          .where(and(
            eq(reasonedReviewEvidence.tenantId, evidence.tenantId),
            eq(reasonedReviewEvidence.id, existing.id),
          ));
        return "reserved";
      }
      return "duplicate";
    }

    if (evidence.mode === "canary") {
      const rollbackCutoff = new Date(Date.now() - CANARY_ROLLBACK_COOLDOWN_MS);
      const activeRollback = await tx.select({ id: reasonedReviewEvidence.id })
        .from(reasonedReviewEvidence)
        .where(and(
          eq(reasonedReviewEvidence.tenantId, evidence.tenantId),
          eq(reasonedReviewEvidence.deliverableType, evidence.deliverableType),
          eq(reasonedReviewEvidence.mode, "canary"),
          eq(reasonedReviewEvidence.rollbackTriggered, true),
          gte(reasonedReviewEvidence.createdAt, rollbackCutoff),
        ))
        .limit(1);
      if (activeRollback.length) return "rollback";
    }

    if (spent + evidence.estimatedCostUsd > MAX_TENANT_DAILY_COST_USD) {
      return "over_budget";
    }

    await tx.insert(reasonedReviewEvidence).values({
      tenantId: evidence.tenantId,
      deliverableType: evidence.deliverableType,
      mode: evidence.mode,
      status: "reserved",
      idempotencyKey: evidence.idempotencyKey,
      provenance: evidence.provenance,
      baselineCandidateHash: evidence.baselineCandidateHash,
      recommendedCandidateHash: null,
      baselineDecision: "baseline",
      decisionUsed: "baseline",
      degraded: false,
      disagreement: false,
      scoreMargin: null,
      estimatedCostUsd: evidence.estimatedCostUsd,
      latencyMs: 0,
      fallbackReason: "review_reserved",
      rollbackTriggered: false,
      validReviewerCount: 0,
      actualReviewerModels: [],
    });
    return "reserved";
  });
}

async function finalizeProductionEvidence(evidence: ProductionReviewEvidence): Promise<ProductionReviewEvidence> {
  return withTenantTx(evidence.tenantId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(177, ${evidence.tenantId})`);
    const reservation = await tx.select({ estimatedCostUsd: reasonedReviewEvidence.estimatedCostUsd })
      .from(reasonedReviewEvidence)
      .where(and(
        eq(reasonedReviewEvidence.tenantId, evidence.tenantId),
        eq(reasonedReviewEvidence.idempotencyKey, evidence.idempotencyKey),
      ))
      .limit(1);
    evidence.estimatedCostUsd = Math.max(
      evidence.estimatedCostUsd,
      Number(reservation[0]?.estimatedCostUsd || 0),
    );
    if (evidence.mode !== "canary") {
      await writeEvidence(tx, evidence);
      return evidence;
    }
    const recent = await tx.select({ decisionUsed: reasonedReviewEvidence.decisionUsed })
      .from(reasonedReviewEvidence)
      .where(and(
        eq(reasonedReviewEvidence.tenantId, evidence.tenantId),
        eq(reasonedReviewEvidence.deliverableType, evidence.deliverableType),
        eq(reasonedReviewEvidence.mode, "canary"),
        eq(reasonedReviewEvidence.status, "complete"),
      ))
      .orderBy(desc(reasonedReviewEvidence.createdAt))
      .limit(CANARY_ROLLBACK_WINDOW - 1);
    const rollbackTriggered = shouldTriggerAutomaticRollback([
      ...recent.map((row: { decisionUsed: string }) => row.decisionUsed === "canary" ? "canary" as const : "baseline" as const),
      evidence.decisionUsed,
    ]);
    if (rollbackTriggered) {
      evidence.rollbackTriggered = true;
      evidence.decisionUsed = "baseline";
      evidence.fallbackReason = "canary_automatic_rollback";
    }
    await writeEvidence(tx, evidence);
    return evidence;
  });
}

function disabledResult(input: ProductionReviewInput, reason: string): ProductionReviewResult {
  return {
    enabled: false,
    mode: "disabled",
    decisionUsed: "baseline",
    selectedCandidateId: input.baselineCandidateId,
    recommendationCandidateId: null,
    scoreMargin: null,
    degraded: false,
    disagreement: false,
    estimatedCostUsd: 0,
    latencyMs: 0,
    fallbackReason: reason,
    rollbackTriggered: false,
  };
}

function evidenceFor(
  input: ProductionReviewInput,
  mode: ProductionReviewMode,
  candidates: ProductionReviewCandidate[],
  reviewers: string[],
  idempotencyKey: string,
  estimatedCostUsd: number,
  fallbackReason: string | null,
): ProductionReviewEvidence {
  const baseline = candidates.find((candidate) => candidate.id === input.baselineCandidateId);
  const hasHashKey = Boolean(process.env.SESSION_SECRET);
  return {
    tenantId: input.tenantId,
    deliverableType: input.deliverableType.trim(),
    mode,
    status: "complete",
    idempotencyKey,
    provenance: {
      source: boundedText(input.provenance?.source, 100) || "deliverable-candidate-seam",
      // Labels can contain customer-selected headings. Persist only a digest.
      label: hash(boundedText(input.provenance?.label, 160) || "unlabeled"),
      benchmarkVersion: boundedText(input.provenance?.benchmarkVersion, 80) || "production-shadow-v1",
      candidateCount: candidates.length,
      candidateHashes: candidates.map((candidate) => hasHashKey
        ? contentHash(candidate.content, input.tenantId)
        : hash(candidate.id)),
      configuredReviewerModels: reviewers,
      reviewerModels: [],
      reviewerFailureClasses: [],
      reviewersIndependent: false,
    },
    baselineCandidateHash: baseline && hasHashKey
      ? contentHash(baseline.content, input.tenantId)
      : hash(input.baselineCandidateId || "missing-baseline"),
    recommendedCandidateHash: null,
    baselineDecision: "baseline",
    decisionUsed: "baseline",
    degraded: false,
    disagreement: false,
    scoreMargin: null,
    estimatedCostUsd,
    latencyMs: 0,
    fallbackReason,
    rollbackTriggered: false,
    validReviewerCount: 0,
    actualReviewerModels: [],
  };
}

/**
 * Review a real candidate set. The default result always selects the baseline.
 * Callers must explicitly opt into the canary and still retain all downstream
 * verification, approval, HITL, and delivery gates.
 */
export async function reviewDeliverableCandidates(
  input: ProductionReviewInput,
  deps: ProductionReviewDeps = {},
): Promise<ProductionReviewResult> {
  const now = deps.now || Date.now;
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId <= 0) {
    return disabledResult(input, "invalid_tenant");
  }
  if (!input.deliverableType?.trim()) return disabledResult(input, "missing_deliverable_type");
  const controls = controlsFor(input, process.env);
  if (!controls.mode) return disabledResult(input, controls.fallbackReason || "disabled");
  const rawCandidates = Array.isArray(input.candidates) ? input.candidates : [];
  const candidates = rawCandidates.map((candidate) => ({
    id: boundedText(candidate?.id, 160).trim(),
    content: boundedText(candidate?.content, MAX_CANDIDATE_CHARS),
    generatorModel: boundedText(candidate?.generatorModel, 160) || undefined,
  }));
  const fallbackKey = input.idempotencyKey?.trim()
    ? `reasoned-review:${hash(input.idempotencyKey.trim())}`
    : `reasoned-review:${hash(`${input.tenantId}:${input.deliverableType}:${candidates.map((candidate) => candidate.id).join("|")}`)}`;
  const persistFallback = deps.persist || persistProductionEvidence;
  const auditFallback = async (
    reason: string,
    estimatedCostUsd = 0,
    base?: ProductionReviewEvidence,
    persistAttempt = true,
  ): Promise<ProductionReviewResult> => {
    const evidence = base || evidenceFor(
      input,
      controls.mode!,
      candidates,
      controls.reviewers,
      fallbackKey,
      estimatedCostUsd,
      reason,
    );
    evidence.status = "complete";
    evidence.decisionUsed = "baseline";
    evidence.fallbackReason = reason;
    evidence.estimatedCostUsd = estimatedCostUsd;
    if (persistAttempt) {
      try {
        await persistFallback(evidence);
      } catch (error) {
        // Metadata is advisory for baseline outcomes. The real shadow caller is
        // fire-and-forget, and no evidence outage may block existing delivery.
        console.error("[reasoned-review] fallback evidence persistence failed", {
          tenantId: input.tenantId,
          deliverableType: input.deliverableType,
          idempotencyKey: evidence.idempotencyKey,
          mode: controls.mode,
          reason,
        }, redactedError(error));
      }
    }
    return {
      enabled: true,
      mode: controls.mode!,
      decisionUsed: "baseline",
      selectedCandidateId: input.baselineCandidateId,
      recommendationCandidateId: null,
      scoreMargin: null,
      degraded: evidence.degraded,
      disagreement: evidence.disagreement,
      estimatedCostUsd,
      latencyMs: evidence.latencyMs,
      fallbackReason: reason,
      rollbackTriggered: evidence.rollbackTriggered,
      evidence,
    };
  };

  if (candidates.length < 2) return auditFallback("malformed_candidate_set");
  if (candidates.length > MAX_CANDIDATES) return auditFallback("candidate_count_over_budget");
  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (ids.size !== candidates.length || candidates.some((candidate) => !candidate.id || !candidate.content)) {
    return auditFallback("malformed_candidate");
  }
  if (!ids.has(input.baselineCandidateId)) return auditFallback("baseline_missing");
  if (!process.env.SESSION_SECRET) return auditFallback("evidence_hash_key_unavailable");
  if (controls.reviewers.length !== MAX_REVIEWERS || new Set(controls.reviewers).size !== MAX_REVIEWERS) {
    return auditFallback("reviewer_configuration_invalid");
  }
  if (controls.reviewers.some((model) => !ALLOWED_REVIEWER_MODELS.has(model))) {
    return auditFallback("reviewer_pricing_unavailable");
  }
  const generatorModels = new Set(candidates.map((candidate) => candidate.generatorModel?.trim()).filter(Boolean));
  if (controls.reviewers.some((model) => generatorModels.has(model))) {
    return auditFallback("reviewer_independence_unavailable");
  }

  const rubric = boundedText(input.rubric, MAX_RUBRIC_CHARS);
  if (!rubric) return auditFallback("malformed_rubric");
  const estimatedInputTokens = Math.ceil((rubric.length + candidates.reduce((sum, candidate) => sum + candidate.content.length, 0)) / 4);
  const reviewerCostEstimates = controls.reviewers.map((model) => estimateCostUsd(model, estimatedInputTokens, 400));
  if (reviewerCostEstimates.some((cost) => !Number.isFinite(cost) || cost <= 0)) {
    return auditFallback("reviewer_pricing_unavailable");
  }
  const estimatedRunCost = reviewerCostEstimates.reduce((sum, cost) => sum + cost, 0);
  const key = makeIdempotencyKey(input, candidates);
  const evidence = evidenceFor(input, controls.mode, candidates, controls.reviewers, key, estimatedRunCost, "review_reserved");
  if (estimatedRunCost > MAX_REVIEW_COST_USD) return auditFallback("review_budget_exceeded", 0, evidence);
  const anyInjectedDurableControl = Boolean(deps.persist || deps.reserve || deps.shouldRollback);
  const completeInjectedDurableControls = Boolean(deps.persist && deps.reserve && deps.shouldRollback);
  if (controls.mode === "canary" && anyInjectedDurableControl && !completeInjectedDurableControls) {
    return auditFallback("durable_controls_unavailable", 0, evidence);
  }
  let reservation: "reserved" | "duplicate" | "over_budget" | "rollback";
  try {
    reservation = deps.reserve
      ? await deps.reserve(evidence)
      : controls.mode === "shadow" && deps.persist
        ? "reserved"
      : await reserveProductionEvidence({ ...evidence, status: "reserved" });
  } catch (error) {
    console.error("[reasoned-review] durable budget reservation failed", {
      tenantId: input.tenantId,
      deliverableType: input.deliverableType,
      idempotencyKey: evidence.idempotencyKey,
      mode: controls.mode,
    }, redactedError(error));
    return auditFallback("budget_reservation_unavailable", 0, evidence);
  }
  if (reservation === "duplicate") return auditFallback("duplicate_review_suppressed", 0, evidence, false);
  if (reservation === "over_budget") return auditFallback("review_budget_exceeded", 0, evidence);
  if (reservation === "rollback") return auditFallback("canary_automatic_rollback", 0, evidence);

  const startedAt = now();
  const reviewerFactory = deps.review || ((reviewInput, model) => realReview(reviewInput, model));
  const actualReviewerModels: string[] = [];
  const reviewers: ReasonedReviewer[] = controls.reviewers.map((model, index) => ({
    model,
    review: async (reviewInput) => {
      const verdict = await reviewerFactory(reviewInput, model);
      actualReviewerModels[index] = verdict.actualModel || model;
      return verdict;
    },
  }));
  let trial;
  try {
    trial = await runReasonedReviewTrial({
      benchmarkVersion: input.provenance?.benchmarkVersion || "production-shadow-v1",
      cases: [{
        id: `${input.tenantId}:${hash(key)}`,
        rubric,
        baselineCandidateId: input.baselineCandidateId,
        expectedWinnerId: input.baselineCandidateId,
        candidates,
      }],
      reviewers,
    });
  } catch (error) {
    evidence.degraded = true;
    evidence.latencyMs = Math.max(0, now() - startedAt);
    console.error("[reasoned-review] review execution failed", {
      tenantId: input.tenantId,
      deliverableType: input.deliverableType,
      idempotencyKey: evidence.idempotencyKey,
      mode: controls.mode,
    }, redactedError(error));
    return auditFallback("review_execution_failed", estimatedRunCost, evidence);
  }

  const caseResult = trial.cases[0];
  const reviewerFailureClasses = [...new Set(
    (caseResult?.reviewerVerdicts || [])
      .filter((verdict) => Boolean(verdict.error))
      .map((verdict) => reviewerFailureClass(verdict.error || "execution_error")),
  )];
  if (reviewerFailureClasses.length) {
    console.error("[reasoned-review] one or more reviewers degraded", {
      tenantId: input.tenantId,
      deliverableType: input.deliverableType,
      idempotencyKey: evidence.idempotencyKey,
      mode: controls.mode,
      failureClasses: reviewerFailureClasses,
    });
  }
  const validReviewerCount = caseResult?.reviewerVerdicts.filter((verdict) => !verdict.error).length || 0;
  const actualModels = actualReviewerModels.filter(Boolean);
  const reviewersIndependent = validReviewerCount === MAX_REVIEWERS
    && actualModels.length === MAX_REVIEWERS
    && new Set(actualModels).size === MAX_REVIEWERS
    && actualModels.every((model) => !generatorModels.has(model));
  const scoreValues = caseResult ? Object.values(caseResult.scoresByCandidate).sort((a, b) => b - a) : [];
  const scoreMargin = scoreValues.length > 1 ? scoreValues[0] - scoreValues[1] : null;
  const recommendation = caseResult?.winnerCandidateId || null;
  const degraded = !caseResult
    || caseResult.degraded
    || trial.status === "degraded"
    || validReviewerCount !== MAX_REVIEWERS
    || !reviewersIndependent;
  const disagreement = caseResult?.disagreement === true;
  let canUseCanary = controls.mode === "canary"
    && !degraded
    && reviewersIndependent
    && !disagreement
    && recommendation !== null
    && scoreMargin !== null
    && scoreMargin >= MIN_CANARY_MARGIN;
  let decisionUsed: "baseline" | "canary" = canUseCanary ? "canary" : "baseline";
  let fallbackReason = canUseCanary
    ? null
    : !reviewersIndependent ? "reviewer_independence_unavailable"
      : degraded ? "review_degraded"
      : disagreement ? "review_disagreement"
        : scoreMargin === null || scoreMargin < MIN_CANARY_MARGIN ? "review_low_margin"
          : "baseline_authoritative";
  const latencyMs = Math.max(0, now() - startedAt);
  Object.assign(evidence, {
    status: "complete" as const,
    recommendedCandidateHash: recommendation
      ? contentHash(candidates.find((candidate) => candidate.id === recommendation)?.content || recommendation, input.tenantId)
      : null,
    decisionUsed,
    degraded,
    disagreement,
    scoreMargin,
    estimatedCostUsd: trial.metrics.totalCostUsd || estimatedRunCost,
    latencyMs,
    fallbackReason,
    validReviewerCount,
    actualReviewerModels: actualModels,
  });
  evidence.provenance.reviewerModels = actualModels;
  evidence.provenance.reviewerFailureClasses = reviewerFailureClasses;
  evidence.provenance.reviewersIndependent = reviewersIndependent;
  // Shadow persistence is deliberately awaited only inside this adapter. The
  // production caller invokes the adapter fire-and-forget, so delivery cannot
  // wait on a telemetry database. Tests and canary callers receive evidence.
  try {
    if (deps.persist) {
      if (controls.mode === "canary") {
        try {
          if (await deps.shouldRollback!(evidence)) {
            evidence.rollbackTriggered = true;
            evidence.decisionUsed = "baseline";
            evidence.fallbackReason = "canary_automatic_rollback";
          }
        } catch (error) {
          canUseCanary = false;
          evidence.decisionUsed = "baseline";
          evidence.fallbackReason = "rollback_state_unavailable";
          console.error("[reasoned-review] rollback state unavailable", {
            tenantId: input.tenantId,
            deliverableType: input.deliverableType,
            idempotencyKey: evidence.idempotencyKey,
            mode: controls.mode,
          }, redactedError(error));
        }
      }
      await deps.persist(evidence);
    } else {
      await finalizeProductionEvidence(evidence);
    }
  } catch (error) {
    // Selection without durable evidence or rollback state is unauditable.
    if (controls.mode === "canary") {
      canUseCanary = false;
      evidence.decisionUsed = "baseline";
      evidence.fallbackReason = "evidence_persistence_failed";
    }
    console.error("[reasoned-review] final evidence or rollback persistence failed", {
      tenantId: input.tenantId,
      deliverableType: input.deliverableType,
      idempotencyKey: evidence.idempotencyKey,
      mode: controls.mode,
    }, redactedError(error));
  }
  if (evidence.rollbackTriggered || evidence.decisionUsed !== "canary") canUseCanary = false;
  decisionUsed = canUseCanary ? "canary" : "baseline";
  fallbackReason = canUseCanary ? null : evidence.fallbackReason || fallbackReason;
  evidence.decisionUsed = decisionUsed;
  evidence.fallbackReason = fallbackReason;
  return {
    enabled: true,
    mode: controls.mode,
    decisionUsed,
    selectedCandidateId: canUseCanary ? recommendation! : input.baselineCandidateId,
    recommendationCandidateId: recommendation,
    scoreMargin,
    degraded,
    disagreement,
    estimatedCostUsd: evidence.estimatedCostUsd,
    latencyMs,
    ...(fallbackReason ? { fallbackReason } : {}),
    rollbackTriggered: evidence.rollbackTriggered,
    evidence,
  };
}