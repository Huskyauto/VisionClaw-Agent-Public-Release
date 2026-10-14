import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const WORKSPACE_VERIFIER_PREFIX = "/internal/workspace-verifier";
export const MAX_WORKSPACE_VERIFIER_BYTES = 128 * 1024;
export const WORKSPACE_VERIFIER_KINDS = ["research_proposal_verification", "source_repair_verification"] as const;
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const HASH_PATTERN = /^[a-f0-9]{64}$/;
export interface WorkspaceProposalSnapshot {
  version: 1;
  jobId: number;
  tenantId: number;
  proposalId: number;
  attempt: number;
  leaseUntil: number;
  nonce: string;
  targetFile: string;
  codeDiff: string;
  sourceSha256: string;
  contextSha256: string;
}
const PATHS = new Set([`${WORKSPACE_VERIFIER_PREFIX}/claim`, `${WORKSPACE_VERIFIER_PREFIX}/settle`]);
export const WORKSPACE_CONTEXT_PREFIX = "WORKSPACE_VERIFIER_CONTEXT_SHA256:";

export function readWorkspaceVerificationContext(details: string): string | undefined {
  const lines = details.split(/\r?\n/).filter(line => line.startsWith(WORKSPACE_CONTEXT_PREFIX));
  if (!lines.length) return undefined;
  const hash = lines[0].slice(WORKSPACE_CONTEXT_PREFIX.length);
  if (lines.length !== 1 || !HASH_PATTERN.test(hash)) throw new Error("Invalid workspace verification context");
  return hash;
}

export function validVerifierTarget(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512
    && /^(server|shared|client\/src|scripts)\/[a-zA-Z0-9_./-]+\.(ts|tsx)$/.test(value)
    && value.split("/").every(part => part !== "." && part !== ".." && part !== "");
}

export function validateWorkspaceSnapshot(value: unknown): WorkspaceProposalSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid verifier snapshot");
  const s = value as WorkspaceProposalSnapshot;
  if (s.version !== 1 || ![s.jobId, s.tenantId, s.proposalId, s.attempt, s.leaseUntil]
    .every(v => Number.isSafeInteger(v) && v > 0)
    || typeof s.nonce !== "string" || !UUID_PATTERN.test(s.nonce)
    || !validVerifierTarget(s.targetFile)
    || typeof s.codeDiff !== "string" || Buffer.byteLength(s.codeDiff) > 96 * 1024
    || typeof s.sourceSha256 !== "string" || !HASH_PATTERN.test(s.sourceSha256)
    || typeof s.contextSha256 !== "string" || !HASH_PATTERN.test(s.contextSha256)) {
    throw new Error("Invalid verifier snapshot");
  }
  // Explicit projection: untrusted sibling fields do not become authority.
  return {
    version: 1, jobId: s.jobId, tenantId: s.tenantId, proposalId: s.proposalId,
    attempt: s.attempt, leaseUntil: s.leaseUntil, nonce: s.nonce,
    targetFile: s.targetFile, codeDiff: s.codeDiff,
    sourceSha256: s.sourceSha256, contextSha256: s.contextSha256,
  };
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A repair-handoff signature can never authorize a verifier request. */
export function signWorkspaceRequest(key: string, pathname: string, body: string, timestamp: number): string {
  if (key.length < 16 || !PATHS.has(pathname) || !Number.isSafeInteger(timestamp)
    || timestamp < 1 || Buffer.byteLength(body) > MAX_WORKSPACE_VERIFIER_BYTES) {
    throw new Error("Invalid workspace verification request");
  }
  return createHmac("sha256", key)
    .update(`workspace-proposal-verification:v1\nPOST\n${pathname}\n${timestamp}\n${sha256Text(body)}`)
    .digest("hex");
}

export function authenticateWorkspaceRequest(
  key: string, pathname: string, body: string, timestamp: unknown, signature: unknown, now: number,
): boolean {
  if (typeof timestamp !== "string" || !/^[1-9]\d{0,15}$/.test(timestamp)
    || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const parsed = Number(timestamp);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(parsed) || Math.abs(now - parsed) > 60_000) return false;
  try {
    const expected = signWorkspaceRequest(key, pathname, body, parsed);
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}
