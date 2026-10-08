import { createHash, randomUUID } from "crypto";
import { openCheckpoints, type CheckpointStore } from "./agentic/pipeline-checkpoint";

export interface ToolBudgetResumeMetadata {
  budgetKind: "tool_calls";
  resumable: true;
  resumeId: string;
  deferredResearchCount: number;
}
export interface DeferredResearchCall {
  toolName: string;
  argumentsJson: string;
}

interface ToolBudgetResumeArtifact {
  claimUntil?: number;
  deferredCalls?: unknown[];
  [key: string]: unknown;
}

function isDeferredResearchCall(call: unknown): call is DeferredResearchCall {
  if (!call || typeof call !== "object") return false;
  const candidate = call as Partial<DeferredResearchCall>;
  return typeof candidate.toolName === "string"
    && /^[a-z][a-z0-9_]{0,99}$/.test(candidate.toolName)
    && typeof candidate.argumentsJson === "string";
}

function firstReturnedArtifact(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("rows" in result)) return undefined;
  const rows = result.rows;
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== "object" || !("artifact" in rows[0])) {
    return undefined;
  }
  return rows[0].artifact;
}

function resumeIdFor(tenantId: number, conversationId: number): string {
  // The tenant ID scopes the durable record, but is never returned to the
  // caller. The opaque ID is stable so subsequent turns resume the same work.
  return createHash("sha256")
    .update(`chat-tool-budget-resume:${tenantId}:${conversationId}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Persist a minimal checkpoint before withholding nonessential research.
 * This deliberately records no tool arguments, user content, or tenant data:
 * the tenant-scoped checkpoint key is the authoritative resume boundary.
 */
export async function persistToolBudgetResume(input: {
  tenantId: number;
  conversationId: number;
  issuedCalls: number;
  deferredResearchCount: number;
  deferredCalls: DeferredResearchCall[];
  store?: CheckpointStore;
}): Promise<ToolBudgetResumeMetadata> {
  const resumeId = resumeIdFor(input.tenantId, input.conversationId);
  const checkpoint = await openCheckpoints({
    tenantId: input.tenantId,
    jobKey: `chat-tool-budget-${resumeId}`,
    store: input.store,
  });
  const metadata: ToolBudgetResumeMetadata = {
    budgetKind: "tool_calls",
    resumable: true,
    resumeId,
    deferredResearchCount: input.deferredResearchCount,
  };
  await checkpoint.store.upsert({
    tenantId: input.tenantId,
    jobKey: checkpoint.jobKey,
    stage: "research_resume",
    unitKey: "",
    status: "completed",
    artifact: {
      budgetKind: metadata.budgetKind,
      deferredResearchCount: metadata.deferredResearchCount,
      issuedCalls: Math.max(0, input.issuedCalls),
      deferredCalls: input.deferredCalls.slice(0, 8).map((call) => ({
        toolName: /^[a-z][a-z0-9_]{0,99}$/.test(call.toolName) ? call.toolName : "unknown_research_tool",
        argumentsJson: call.argumentsJson.slice(0, 8_000),
      })),
    },
  });
  return metadata;
}

export async function loadPendingToolBudgetResume(input: {
  tenantId: number;
  conversationId: number;
  store?: CheckpointStore;
}): Promise<{ resumeId: string; deferredCalls: DeferredResearchCall[] } | null> {
  const resumeId = resumeIdFor(input.tenantId, input.conversationId);
  const checkpoint = await openCheckpoints({
    tenantId: input.tenantId,
    jobKey: `chat-tool-budget-${resumeId}`,
    store: input.store,
  });
  const artifact = checkpoint.artifact<ToolBudgetResumeArtifact>("research_resume");
  if (!artifact || !Array.isArray(artifact.deferredCalls) || artifact.deferredCalls.length === 0) return null;
  return {
    resumeId,
    deferredCalls: artifact.deferredCalls
      .filter(isDeferredResearchCall)
      .slice(0, 8),
  };
}

const injectedClaimLocks = new Map<string, Promise<void>>();
const RESUME_CLAIM_LEASE_MS = 5 * 60 * 1000;

function pendingFromArtifact(
  resumeId: string,
  artifact: unknown,
): { resumeId: string; deferredCalls: DeferredResearchCall[] } | null {
  if (!artifact || typeof artifact !== "object" || !("deferredCalls" in artifact)
    || !Array.isArray(artifact.deferredCalls) || artifact.deferredCalls.length === 0) return null;
  return {
    resumeId,
    deferredCalls: artifact.deferredCalls
      .filter(isDeferredResearchCall)
      .slice(0, 8),
  };
}

export async function claimPendingToolBudgetResume(input: {
  tenantId: number;
  conversationId: number;
  store?: CheckpointStore;
  deadlineAt?: number;
}): Promise<{ resumeId: string; deferredCalls: DeferredResearchCall[]; _claimToken?: string } | null> {
  const resumeId = resumeIdFor(input.tenantId, input.conversationId);
  const jobKey = `chat-tool-budget-${resumeId}`;
  const now = Date.now();
  const claimUntil = now + RESUME_CLAIM_LEASE_MS;
  if (input.deadlineAt != null && now >= input.deadlineAt) return null;
  const claimToken = input.deadlineAt != null ? randomUUID() : undefined;
  const finishClaim = async (artifact: unknown) => {
    const pending = pendingFromArtifact(resumeId, artifact);
    if (claimToken && input.deadlineAt != null && Date.now() >= input.deadlineAt) {
      await releasePendingToolBudgetResumeClaim({ ...input, claimToken });
      return null;
    }
    return pending ? { ...pending, ...(claimToken ? { _claimToken: claimToken } : {}) } : null;
  };

  if (!input.store) {
    const { ensurePipelineStageArtifactsTable } = await import("./agentic/pipeline-checkpoint-table");
    await ensurePipelineStageArtifactsTable();
    const [{ db }, { sql }] = await Promise.all([import("./db"), import("drizzle-orm")]);
    const claimPatch = JSON.stringify({ claimUntil, ...(claimToken ? { _claimToken: claimToken } : {}) });
    const claimed = await db.execute(sql`
      UPDATE pipeline_stage_artifacts
         SET artifact = artifact || ${claimPatch}::jsonb,
             attempts = attempts + 1,
             updated_at = NOW()
       WHERE tenant_id = ${input.tenantId}
         AND job_key = ${jobKey}
         AND stage = 'research_resume'
         AND unit_key = ''
         AND status = 'completed'
         AND jsonb_array_length(COALESCE(artifact->'deferredCalls', '[]'::jsonb)) > 0
         AND COALESCE((artifact->>'claimUntil')::bigint, 0) < ${now}
          AND (${input.deadlineAt ?? null}::bigint IS NULL OR
               EXTRACT(EPOCH FROM clock_timestamp()) * 1000 < ${input.deadlineAt ?? null}::bigint)
      RETURNING artifact
    `);
    return finishClaim(firstReturnedArtifact(claimed));
  }

  const prior = injectedClaimLocks.get(jobKey) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => held);
  injectedClaimLocks.set(jobKey, queued);
  await prior;
  try {
    const checkpoint = await openCheckpoints({ tenantId: input.tenantId, jobKey, store: input.store });
    const artifact = checkpoint.artifact<ToolBudgetResumeArtifact>("research_resume");
    if (!artifact || Number(artifact.claimUntil || 0) >= now) return null;
    const pending = pendingFromArtifact(resumeId, artifact);
    if (!pending) return null;
    if (input.deadlineAt != null && Date.now() >= input.deadlineAt) return null;
    await checkpoint.store.upsert({
      tenantId: input.tenantId,
      jobKey,
      stage: "research_resume",
      unitKey: "",
      status: "completed",
      artifact: { ...artifact, claimUntil, ...(claimToken ? { _claimToken: claimToken } : {}) },
    });
    return await finishClaim({ ...artifact, claimUntil, ...(claimToken ? { _claimToken: claimToken } : {}) });
  } finally {
    release();
    if (injectedClaimLocks.get(jobKey) === queued) injectedClaimLocks.delete(jobKey);
  }
}

/** Release only this preparation's claim; never another caller's newer lease. */
export async function releasePendingToolBudgetResumeClaim(input: {
  tenantId: number; conversationId: number; claimToken: string; store?: CheckpointStore;
}): Promise<void> {
  const jobKey = `chat-tool-budget-${resumeIdFor(input.tenantId, input.conversationId)}`;
  if (input.store) {
    const rows = await input.store.load(input.tenantId, jobKey);
    const row = rows.find((candidate) => candidate.stage === "research_resume" && candidate.unitKey === "");
    if (row?.artifact?._claimToken !== input.claimToken) return;
    const { _claimToken: _, ...artifact } = row.artifact;
    await input.store.upsert({ tenantId: input.tenantId, jobKey, stage: "research_resume", unitKey: "", status: "completed", artifact: { ...artifact, claimUntil: 0 } });
    return;
  }
  const [{ db }, { sql }] = await Promise.all([import("./db"), import("drizzle-orm")]);
  await db.execute(sql`
    UPDATE pipeline_stage_artifacts
       SET artifact = (artifact - '_claimToken') || '{"claimUntil":0}'::jsonb,
           updated_at = NOW()
     WHERE tenant_id = ${input.tenantId} AND job_key = ${jobKey}
       AND stage = 'research_resume' AND unit_key = '' AND status = 'completed'
       AND artifact->>'_claimToken' = ${input.claimToken}
  `);
}