import { z } from "zod";
import { createHash, randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Request } from "express";

const policySchema = z.object({
  schemaVersion: z.literal("delegation-supervisor-policy/v1"),
  policyVersion: z.string().trim().min(1).max(100),
  mode: z.enum(["off", "report_only"]),
  ownerDecisionStatus: z.enum(["unresolved", "approved"]),
  killSwitch: z.boolean(),
  tierFloors: z.record(z.enum(["tier_0", "tier_1", "tier_2", "tier_3"])).default({}),
}).strict();

export type DelegationSupervisorPolicy = z.infer<typeof policySchema>;

export function buildCeoExecutionAttemptId(
  kind: "initial" | "self-correction" | "backup",
  ordinal = 1,
  targetAgent?: string,
): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new Error("CEO execution attempt ordinal must be a positive integer");
  }
  if (kind === "initial") return "initial";
  if (kind === "self-correction") return `self-correction:${ordinal}`;
  const target = String(targetAgent || "agent").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";
  return `backup:${target}:${ordinal}`;
}

export interface DelegationOwnerDirectContext {
  readonly tenantId: number;
  readonly requesterIdentity: string;
}

const ownerDirectContexts = new WeakSet<object>();

export async function createOwnerDirectContext(
  req: Request,
  requesterIdentity: string,
): Promise<DelegationOwnerDirectContext> {
  const { ADMIN_TENANT_ID, isPlatformAdmin } = await import("./auth");
  if (!isPlatformAdmin(req)) {
    throw new Error("Platform owner authentication required for owner-direct delegation");
  }
  const context = Object.freeze({
    tenantId: ADMIN_TENANT_ID,
    requesterIdentity: canonicalRequesterIdentity(requesterIdentity),
  });
  ownerDirectContexts.add(context);
  return context;
}

export interface DelegationSupervisorTrustedContext {
  tenantId: number;
  requesterIdentity: string;
  isPlatformOwner: boolean;
}

export interface DelegationSupervisorRequest {
  delegationId: string;
  attemptId: string;
  targetAgent: string;
  taskClass: string;
  supervisionMode: "tiered" | "owner_direct";
}

export interface DelegationSupervisorDecision {
  status: "off" | "report_only" | "unresolved_policy" | "kill_switch_active" | "invalid_owner_direct" | "invalid_policy";
  enforcementEnabled: false;
  structurallyValid: boolean;
  finalTier: "tier_0" | "tier_1" | "tier_2" | "tier_3" | null;
  requiresSparkReview: boolean;
  requiresIndependentReview: boolean;
  policyVersion: string;
  tenantId: number;
  delegationId: string;
  attemptId: string;
  receiptPersisted?: boolean;
  receiptError?: "persistence_failed";
}

export type DelegationSupervisorReceiptWriter = (
  decision: DelegationSupervisorDecision,
  context: {
    requesterIdentity: string;
    targetAgent: string;
    source: "chat" | "heartbeat" | "scheduler" | "internal";
    supervisionMode: "tiered" | "owner_direct";
  },
) => Promise<void>;

export function parseDelegationSupervisorPolicy(input: unknown): DelegationSupervisorPolicy {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid delegation supervisor policy: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}

export function loadDelegationSupervisorPolicy(
  filePath = resolve(process.cwd(), "data", "delegation-supervisor-policy.json"),
): DelegationSupervisorPolicy {
  try {
    return parseDelegationSupervisorPolicy(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid delegation supervisor policy: ${message}`);
  }
}

export function evaluateDelegationReportOnly(input: {
  policy: DelegationSupervisorPolicy;
  trustedContext: DelegationSupervisorTrustedContext;
  request: DelegationSupervisorRequest;
}): DelegationSupervisorDecision {
  const { policy, trustedContext, request } = input;
  const invalidOwnerDirect = request.supervisionMode === "owner_direct" && !trustedContext.isPlatformOwner;
  const finalTier = policy.ownerDecisionStatus === "approved"
    ? policy.tierFloors[request.taskClass] ?? null
    : null;

  let status: DelegationSupervisorDecision["status"] = "report_only";
  if (invalidOwnerDirect) status = "invalid_owner_direct";
  else if (policy.mode === "off") status = "off";
  else if (policy.killSwitch) status = "kill_switch_active";
  else if (policy.ownerDecisionStatus === "unresolved" || finalTier === null) status = "unresolved_policy";

  return {
    status,
    enforcementEnabled: false,
    structurallyValid: !invalidOwnerDirect,
    finalTier,
    requiresSparkReview: request.supervisionMode === "tiered" && finalTier === "tier_2",
    requiresIndependentReview: finalTier === "tier_3",
    policyVersion: policy.policyVersion,
    tenantId: trustedContext.tenantId,
    delegationId: request.delegationId,
    attemptId: request.attemptId,
  };
}

export const persistDelegationSupervisorReceipt: DelegationSupervisorReceiptWriter = async (decision, context) => {
  const [{ db }, { sql }] = await Promise.all([
    import("./db"),
    import("drizzle-orm"),
  ]);
  const boundedDecision = JSON.stringify({
    status: decision.status,
    finalTier: decision.finalTier,
    structurallyValid: decision.structurallyValid,
    requiresSparkReview: decision.requiresSparkReview,
    requiresIndependentReview: decision.requiresIndependentReview,
  });
  const inserted = await db.execute(sql`
    INSERT INTO delegation_supervisor_receipts
      (tenant_id, delegation_id, attempt_id, policy_version, supervision_mode,
       source, requester_identity, target_agent, status, final_tier,
       structurally_valid, enforcement_enabled, decision)
    VALUES
      (${decision.tenantId}, ${decision.delegationId}, ${decision.attemptId},
       ${decision.policyVersion}, ${context.supervisionMode}, ${context.source},
       ${context.requesterIdentity}, ${context.targetAgent}, ${decision.status},
       ${decision.finalTier}, ${decision.structurallyValid}, false,
       ${boundedDecision}::jsonb)
    ON CONFLICT (tenant_id, delegation_id, attempt_id, policy_version) DO NOTHING
    RETURNING id
  `);
  const insertedRows = (inserted as any).rows || inserted;
  if (insertedRows?.length) return;
  const existing = await db.execute(sql`
    SELECT supervision_mode, source, requester_identity, target_agent,
           status, final_tier, structurally_valid, enforcement_enabled,
           decision = ${boundedDecision}::jsonb AS decision_matches
    FROM delegation_supervisor_receipts
    WHERE tenant_id = ${decision.tenantId}
      AND delegation_id = ${decision.delegationId}
      AND attempt_id = ${decision.attemptId}
      AND policy_version = ${decision.policyVersion}
    LIMIT 1
  `);
  const row = ((existing as any).rows || existing)?.[0];
  if (
    !row ||
    row.supervision_mode !== context.supervisionMode ||
    row.source !== context.source ||
    row.requester_identity !== context.requesterIdentity ||
    row.target_agent !== context.targetAgent ||
    row.status !== decision.status ||
    (row.final_tier ?? null) !== decision.finalTier ||
    row.structurally_valid !== decision.structurallyValid ||
    row.enforcement_enabled !== false ||
    row.decision_matches !== true
  ) {
    throw new Error("Delegation supervisor receipt identity conflict");
  }
};

export async function reportDelegationAttempt(input: {
  tenantId: number;
  requesterIdentity: string;
  targetAgent: string;
  taskClass?: string;
  supervisionMode?: "tiered" | "owner_direct";
  source: "chat" | "heartbeat" | "scheduler" | "internal";
  policy?: DelegationSupervisorPolicy;
  receiptWriter?: DelegationSupervisorReceiptWriter;
  delegationId?: string;
  attemptId?: string;
  eventWriter?: (decision: DelegationSupervisorDecision) => Promise<void> | void;
  ownerDirectContext?: DelegationOwnerDirectContext;
}): Promise<DelegationSupervisorDecision> {
  const requesterIdentity = canonicalRequesterIdentity(input.requesterIdentity);
  const targetAgent = canonicalTargetAgent(input.targetAgent);
  const ownerContextValid = !!input.ownerDirectContext
    && ownerDirectContexts.has(input.ownerDirectContext)
    && input.ownerDirectContext.tenantId === input.tenantId
    && input.ownerDirectContext.requesterIdentity === requesterIdentity;
  const baseIdentity = [
    input.tenantId,
    requesterIdentity,
    targetAgent,
    input.taskClass ?? "unresolved",
    input.source,
  ].join(":");
  const safeIdentity = /^[A-Za-z0-9:_-]{1,160}$/;
  if (input.delegationId !== undefined && !safeIdentity.test(input.delegationId)) {
    throw new Error("Invalid delegation supervisor delegationId");
  }
  if (input.attemptId !== undefined && !safeIdentity.test(input.attemptId)) {
    throw new Error("Invalid delegation supervisor attemptId");
  }
  const delegationId = input.delegationId ?? `ds_${createHash("sha256").update(baseIdentity).digest("hex").slice(0, 24)}`;
  const attemptId = input.attemptId ?? randomUUID();

  let decision: DelegationSupervisorDecision;
  try {
    const policy = input.policy
      ? parseDelegationSupervisorPolicy(input.policy)
      : loadDelegationSupervisorPolicy();
    decision = evaluateDelegationReportOnly({
      policy,
      trustedContext: {
        tenantId: input.tenantId,
        requesterIdentity,
        isPlatformOwner: ownerContextValid,
      },
      request: {
        delegationId,
        attemptId,
        targetAgent,
        taskClass: input.taskClass ?? "unresolved",
        supervisionMode: input.supervisionMode ?? "tiered",
      },
    });
  } catch (error) {
    decision = {
      status: "invalid_policy",
      enforcementEnabled: false,
      structurallyValid: false,
      finalTier: null,
      requiresSparkReview: false,
      requiresIndependentReview: false,
      policyVersion: "invalid",
      tenantId: input.tenantId,
      delegationId,
      attemptId,
    };
    console.error(`[delegation-supervisor] invalid policy; enforcement remains disabled: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await (input.receiptWriter ?? persistDelegationSupervisorReceipt)(decision, {
      requesterIdentity,
      targetAgent,
      source: input.source,
      supervisionMode: input.supervisionMode ?? "tiered",
    });
    decision.receiptPersisted = true;
  } catch (error) {
    // Phase 1 is report-only: receipt failure is loud and blocks any future
    // enforcement promotion, but does not replace existing execution policy.
    console.error(`[delegation-supervisor] receipt persistence failed; report-only execution unchanged: ${error instanceof Error ? error.message : String(error)}`);
    decision.receiptPersisted = false;
    decision.receiptError = "persistence_failed";
  }

  try {
    if (input.eventWriter) {
      await input.eventWriter(decision);
    } else {
      const { emitDelegationEvent } = await import("./delegation-events");
      emitDelegationEvent({
      conversationId: 0,
      tenantId: input.tenantId,
      type: decision.structurallyValid ? "progress" : "warning",
      agentName: requesterIdentity,
      depth: 0,
      message: `Delegation supervisor report: ${decision.status}`,
      metadata: {
        supervisor: "delegation",
        source: input.source,
        policyVersion: decision.policyVersion,
        supervisionMode: input.supervisionMode ?? "tiered",
        targetAgent,
        finalTier: decision.finalTier,
        enforcementEnabled: false,
        delegationId: decision.delegationId,
        attemptId: decision.attemptId,
      },
      });
    }
  } catch (error) {
    console.error(`[delegation-supervisor] event telemetry failed; report-only execution unchanged: ${error instanceof Error ? error.message : String(error)}`);
  }

  return decision;
}

function canonicalRequesterIdentity(value: string): string {
  const trimmed = String(value || "").trim();
  if (/^(?:system|autonomous-tool|ceo-orchestrator(?::[a-z-]+)?|persona:\d+|session:\d+|subagent:[A-Za-z0-9_-]{1,40})$/.test(trimmed)) {
    return trimmed;
  }
  return `principal:${createHash("sha256").update(trimmed).digest("hex").slice(0, 24)}`;
}

function canonicalTargetAgent(value: string): string {
  const trimmed = String(value || "").trim();
  if (/^[A-Za-z0-9 .:_-]{1,100}$/.test(trimmed)) return trimmed;
  return `agent:${createHash("sha256").update(trimmed).digest("hex").slice(0, 24)}`;
}