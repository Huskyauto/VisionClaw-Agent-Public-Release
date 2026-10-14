import { randomUUID } from "node:crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { captureVerifierSource } from "./workspace-verifier-source";
import {
  sha256Text, validateWorkspaceSnapshot, UUID_PATTERN,
  readWorkspaceVerificationContext,
  type WorkspaceProposalSnapshot,
} from "./workspace-verifier-contract";
import { parseProposalDiff } from "./proposal-diff";
import { extractArtifactAuthorityReceipt, validateArtifactAuthorityReceipt } from "./artifact-authority";
import { heldOutEvalGate } from "../safety/held-out-eval-gate";
import type { VerifyResult } from "../proposal-verifier";

const kinds = sql`AND kind IN ('research_proposal_verification', 'source_repair_verification')`;
// Only a server-issued workspace lease gets its uncompleted attempt restored.
// Legacy attempts retain their existing exhaustion rules.
export const expiredWorkspaceRetryAccounting = {
  status: sql`CASE WHEN payload->'workspaceVerifier'->>'nonce' IS NOT NULL
    AND payload->'workspaceVerifier'->>'snapshotDigest' IS NOT NULL THEN 'pending'
    WHEN attempts >= max_attempts THEN 'failed_terminal' ELSE 'pending' END`,
  attempts: sql`CASE WHEN payload->'workspaceVerifier'->>'nonce' IS NOT NULL
    AND payload->'workspaceVerifier'->>'snapshotDigest' IS NOT NULL
    THEN GREATEST(attempts-1,0) ELSE attempts END`,
};
const rows = (result: any): any[] => result.rows ?? result;

export function workspaceSnapshotDigest(snapshot: WorkspaceProposalSnapshot): string {
  return sha256Text(JSON.stringify(validateWorkspaceSnapshot(snapshot)));
}

export function assertWorkspaceLease(row: any, snapshot: WorkspaceProposalSnapshot, now: number): void {
  const binding = row.payload?.workspaceVerifier;
  if (row.id !== snapshot.jobId || row.tenant_id !== snapshot.tenantId
    || row.attempts !== snapshot.attempt || row.status !== "running"
    || !binding || binding.nonce !== snapshot.nonce
    || binding.snapshotDigest !== workspaceSnapshotDigest(snapshot)
    || new Date(row.lease_until).getTime() !== snapshot.leaseUntil
    || now >= snapshot.leaseUntil) throw new Error("Workspace verification lease fenced");
}

/** Trusted service boundary; no caller-selected job kind or tenant alias. */
export async function claimWorkspaceVerification(requestId: unknown) {
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) throw new Error("Invalid request identity");
  return db.transaction(async tx => {
    // Serialize claims/replays across every production instance.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(125136, 1)`);
    const previous = rows(await tx.execute(sql`
      SELECT id, tenant_id, payload, attempts, lease_until, status FROM agent_jobs
      WHERE payload->'workspaceVerifier'->>'requestId' = ${requestId}
      ${kinds} LIMIT 1
    `));
    if (previous.length) {
      const prior = previous[0];
      if (prior.status !== "running" || new Date(prior.lease_until).getTime() <= Date.now()) {
        return { state: "replayed" as const };
      }
      const proposal = rows(await tx.execute(sql`
        SELECT target_file, code_diff FROM code_proposals
        WHERE id=${prior.payload.proposalId} AND tenant_id=${prior.tenant_id}
      `))[0];
      const binding = prior.payload.workspaceVerifier;
      const snapshot = validateWorkspaceSnapshot({
        version: 1, jobId: prior.id, tenantId: prior.tenant_id,
        proposalId: prior.payload.proposalId, attempt: prior.attempts,
        leaseUntil: new Date(prior.lease_until).getTime(), nonce: binding.nonce,
        targetFile: proposal?.target_file, codeDiff: proposal?.code_diff,
        sourceSha256: binding.sourceSha256, contextSha256: binding.contextSha256,
      });
      assertWorkspaceLease(prior, snapshot, Date.now());
      return { state: "claimed" as const, snapshot };
    }
    await tx.execute(sql`
      UPDATE agent_jobs SET
        status = ${expiredWorkspaceRetryAccounting.status},
        attempts = ${expiredWorkspaceRetryAccounting.attempts},
        next_run_at = NOW() + interval '30 seconds', lease_until = NULL,
        error = 'Workspace verification lease expired; result not accepted'
      WHERE status = 'running' AND (lease_until IS NULL OR lease_until < NOW()) ${kinds}
    `);
    const busy = rows(await tx.execute(sql`
      SELECT id FROM agent_jobs WHERE status = 'running' ${kinds} LIMIT 1
    `));
    if (busy.length) return { state: "busy" as const };
    const selected = rows(await tx.execute(sql`
      SELECT id, tenant_id, payload, attempts FROM agent_jobs
      WHERE status = 'pending' AND next_run_at <= NOW() AND attempts < max_attempts
      ${kinds} ORDER BY next_run_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    `))[0];
    if (!selected) return { state: "idle" as const };
    const proposalId = selected.payload?.proposalId;
    if (!Number.isSafeInteger(selected.tenant_id) || selected.tenant_id <= 0
      || !Number.isSafeInteger(proposalId) || proposalId <= 0) {
      await tx.execute(sql`UPDATE agent_jobs SET status='failed_terminal',
        error='Invalid verification job scope', completed_at=NOW() WHERE id=${selected.id}`);
      return { state: "invalid" as const };
    }
    const proposal = rows(await tx.execute(sql`
      SELECT target_file, code_diff FROM code_proposals
      WHERE id=${proposalId} AND tenant_id=${selected.tenant_id}
      FOR UPDATE
    `))[0];
    if (!proposal) {
      await tx.execute(sql`UPDATE agent_jobs SET status='failed_terminal',
        error='Tenant-scoped proposal not found', completed_at=NOW()
        WHERE id=${selected.id} AND tenant_id=${selected.tenant_id}`);
      return { state: "invalid" as const };
    }
    const source = captureVerifierSource();
    let snapshot: WorkspaceProposalSnapshot;
    try {
      const bytes = source.files.get(proposal.target_file);
      if (!bytes) throw new Error("Unsupported source target");
      snapshot = validateWorkspaceSnapshot({
        version: 1, jobId: selected.id, tenantId: selected.tenant_id,
        proposalId, attempt: selected.attempts + 1, nonce: randomUUID(),
        leaseUntil: Date.now() + 300_000, targetFile: proposal.target_file,
        codeDiff: proposal.code_diff, sourceSha256: sha256Text(bytes.toString("utf8")),
        contextSha256: source.hash,
      });
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 120 * 1024) throw new Error("Snapshot too large");
    } catch {
      await tx.execute(sql`UPDATE agent_jobs SET status='failed_terminal',
        error='Proposal target or payload cannot be safely verified', completed_at=NOW()
        WHERE id=${selected.id} AND tenant_id=${selected.tenant_id}`);
      return { state: "invalid" as const };
    }
    const binding = {
      requestId, nonce: snapshot.nonce, snapshotDigest: workspaceSnapshotDigest(snapshot),
      sourceSha256: snapshot.sourceSha256, contextSha256: snapshot.contextSha256,
    };
    await tx.execute(sql`
      UPDATE code_proposals SET verification_status='unverified',
        verification_details='Queued for workspace verification', verified_at=NULL
      WHERE id=${snapshot.proposalId} AND tenant_id=${snapshot.tenantId}
    `);
    const claimed = rows(await tx.execute(sql`
      UPDATE agent_jobs SET status='running', attempts=${snapshot.attempt}, result=NULL, error=NULL,
        started_at=COALESCE(started_at,NOW()), lease_until=${new Date(snapshot.leaseUntil)},
        payload=jsonb_set(payload, '{workspaceVerifier}', ${JSON.stringify(binding)}::jsonb)
      WHERE id=${snapshot.jobId} AND tenant_id=${snapshot.tenantId} AND status='pending'
      RETURNING id
    `));
    if (claimed.length !== 1) throw new Error("Workspace claim not persisted");
    return { state: "claimed" as const, snapshot };
  });
}

export interface WorkspaceSettlement {
  snapshot: WorkspaceProposalSnapshot;
  result?: VerifyResult;
  deferred?: "source" | "memory" | "indeterminate" | "shutdown";
}

export async function settleWorkspaceVerification(input: WorkspaceSettlement) {
  const snapshot = validateWorkspaceSnapshot(input?.snapshot);
  const result = input.result;
  const deferred = input.deferred;
  if (!!result === !!deferred) throw new Error("One settlement outcome required");
  if (deferred && !["source", "memory", "indeterminate", "shutdown"].includes(deferred)) throw new Error("Invalid deferral");
  if (result && (!["passed", "failed", "skipped"].includes(result.status)
    || typeof result.details !== "string" || result.details.length > 4000
    || !Number.isFinite(result.durationMs) || result.durationMs < 0 || result.durationMs > 240_000)) {
    throw new Error("Invalid verifier result");
  }
  const outcomeDigest = sha256Text(JSON.stringify(result ?? { deferred }));
  return db.transaction(async tx => {
    const row = rows(await tx.execute(sql`
      SELECT id, tenant_id, attempts, status, payload, lease_until, result
      FROM agent_jobs WHERE id=${snapshot.jobId} AND tenant_id=${snapshot.tenantId}
      ${kinds} FOR UPDATE
    `))[0];
    if (!row) throw new Error("Verification job not found");
    const binding = row.payload?.workspaceVerifier;
    if (binding?.snapshotDigest === workspaceSnapshotDigest(snapshot)
      && row.result?.workspaceOutcomeDigest === outcomeDigest
      && (row.status === "succeeded" || row.status === "pending")) return { state: "already_settled" };
    assertWorkspaceLease(row, snapshot, Date.now());
    if (deferred) {
      const delay = deferred === "source" ? 30 * 60_000 : 2 * 60_000;
      await tx.execute(sql`
        UPDATE agent_jobs SET status='pending', attempts=GREATEST(attempts-1,0),
          next_run_at=${new Date(Date.now() + delay)}, lease_until=NULL,
          error=${`Workspace verification deferred: ${deferred}`},
          result=${JSON.stringify({ workspaceOutcomeDigest: outcomeDigest })}::jsonb
        WHERE id=${snapshot.jobId} AND tenant_id=${snapshot.tenantId}
      `);
      return { state: "deferred" };
    }
    const source = captureVerifierSource();
    if (source.hash !== snapshot.contextSha256) throw new Error("Production source changed during verification");
    const parsed = parseProposalDiff(snapshot.codeDiff);
    if (result!.status === "passed") {
      const receipt = extractArtifactAuthorityReceipt(result!.details);
      if (!parsed || !receipt || readWorkspaceVerificationContext(result!.details) !== snapshot.contextSha256
        || !heldOutEvalGate({
        targetFile: snapshot.targetFile, oldCode: parsed.oldCode, newCode: parsed.newCode,
      }).passed || !validateArtifactAuthorityReceipt(receipt, {
        authorityId: "research-proposal-tsc-heldout", tenantId: snapshot.tenantId,
        subjectKind: "research_code_proposal", subjectId: String(snapshot.proposalId),
        subject: {
          targetFile: snapshot.targetFile, sourceSha256: snapshot.sourceSha256,
          proposal: parsed, compilerContextSha256: snapshot.contextSha256,
        },
        requiredVerdict: "accepted",
      }).valid) throw new Error("Workspace verification receipt rejected");
    }
    const updated = rows(await tx.execute(sql`
      UPDATE code_proposals SET verification_status=${result!.status},
        verification_details=${result!.details}, verified_at=NOW()
      WHERE id=${snapshot.proposalId} AND tenant_id=${snapshot.tenantId}
        AND target_file=${snapshot.targetFile} AND code_diff=${snapshot.codeDiff}
      RETURNING id
    `));
    if (updated.length !== 1) throw new Error("Proposal changed during verification");
    const completed = rows(await tx.execute(sql`
      UPDATE agent_jobs SET status='succeeded', completed_at=NOW(), lease_until=NULL,
        error=NULL, result=${JSON.stringify({ ...result, workspaceOutcomeDigest: outcomeDigest })}::jsonb
      WHERE id=${snapshot.jobId} AND tenant_id=${snapshot.tenantId}
        AND status='running' AND attempts=${snapshot.attempt} AND lease_until>NOW()
      RETURNING id
    `));
    if (completed.length !== 1) throw new Error("Workspace completion fenced");
    return { state: "completed" };
  });
}
