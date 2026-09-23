import { createHash } from "node:crypto";

export const ARTIFACT_AUTHORITY_RECEIPT_PREFIX = "ARTIFACT_AUTHORITY_RECEIPT_V1=";

const AUTHORITY_REGISTRY = {
  "research-proposal-tsc-heldout": {
    version: "1",
    subjectKind: "research_code_proposal",
  },
} as const;

export type ArtifactAuthorityId = keyof typeof AUTHORITY_REGISTRY;
export type ArtifactAuthorityVerdict = "accepted" | "rejected" | "indeterminate";

export interface ArtifactAuthorityReceipt {
  schemaVersion: 1;
  authorityId: ArtifactAuthorityId;
  authorityVersion: string;
  tenantId: number;
  subjectKind: string;
  subjectId: string;
  subjectDigest: string;
  verdict: ArtifactAuthorityVerdict;
  reasonCodes: string[];
  evidenceDigest: string;
  receiptDigest: string;
}

export interface IssueArtifactAuthorityReceiptInput {
  authorityId: ArtifactAuthorityId;
  tenantId: number;
  subjectKind: string;
  subjectId: string;
  subject: unknown;
  verdict: ArtifactAuthorityVerdict;
  reasonCodes: string[];
  evidence: unknown;
}

export interface ValidateArtifactAuthorityReceiptInput {
  authorityId: ArtifactAuthorityId;
  tenantId: number;
  subjectKind: string;
  subjectId: string;
  subject: unknown;
  requiredVerdict?: ArtifactAuthorityVerdict;
}

export type ArtifactAuthorityValidation =
  | { valid: true }
  | { valid: false; reason: string };

function assertPositiveTenantId(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("artifact authority tenantId must be a positive integer");
  }
}

function assertBoundedIdentifier(value: string, label: string): void {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 160
    || !/^[A-Za-z0-9._:/-]+$/.test(value)
  ) {
    throw new Error(`artifact authority ${label} is invalid`);
  }
}

function normalizeJson(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("artifact authority payload contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("artifact authority payload contains a cycle");
    seen.add(value);
    const normalized = value.map((entry) => normalizeJson(entry, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) throw new Error("artifact authority payload contains a cycle");
    seen.add(value as object);
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) throw new Error("artifact authority payload contains undefined");
      normalized[key] = normalizeJson(entry, seen);
    }
    seen.delete(value as object);
    return normalized;
  }
  throw new Error(`artifact authority payload contains unsupported ${typeof value}`);
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function artifactAuthoritySha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertArtifactAuthorityPersisted(result: unknown): void {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];
  if (rows.length !== 1) {
    throw new Error(`artifact authority persistence failed: expected 1 updated row, got ${rows.length}`);
  }
}

function receiptBody(receipt: Omit<ArtifactAuthorityReceipt, "receiptDigest">): Omit<ArtifactAuthorityReceipt, "receiptDigest"> {
  return receipt;
}

export function issueArtifactAuthorityReceipt(
  input: IssueArtifactAuthorityReceiptInput,
): ArtifactAuthorityReceipt {
  assertPositiveTenantId(input.tenantId);
  assertBoundedIdentifier(input.subjectKind, "subjectKind");
  assertBoundedIdentifier(input.subjectId, "subjectId");

  const authority = AUTHORITY_REGISTRY[input.authorityId];
  if (!authority) throw new Error("artifact authority is not registered");
  if (input.subjectKind !== authority.subjectKind) {
    throw new Error("artifact authority does not support this subject kind");
  }

  const reasonCodes = [...new Set(input.reasonCodes)].sort();
  if (
    reasonCodes.length < 1
    || reasonCodes.length > 20
    || reasonCodes.some((code) => !/^[a-z0-9_:-]{1,80}$/.test(code))
  ) {
    throw new Error("artifact authority reason codes are invalid");
  }

  const body = receiptBody({
    schemaVersion: 1,
    authorityId: input.authorityId,
    authorityVersion: authority.version,
    tenantId: input.tenantId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectDigest: sha256(input.subject),
    verdict: input.verdict,
    reasonCodes,
    evidenceDigest: sha256(input.evidence),
  });

  return {
    ...body,
    receiptDigest: sha256(body),
  };
}

export function validateArtifactAuthorityReceipt(
  receipt: ArtifactAuthorityReceipt,
  expected: ValidateArtifactAuthorityReceiptInput,
): ArtifactAuthorityValidation {
  try {
    assertPositiveTenantId(expected.tenantId);
    assertBoundedIdentifier(expected.subjectKind, "subjectKind");
    assertBoundedIdentifier(expected.subjectId, "subjectId");

    const authority = AUTHORITY_REGISTRY[expected.authorityId];
    if (!authority) return { valid: false, reason: "unknown_authority" };
    if (
      receipt.schemaVersion !== 1
      || receipt.authorityId !== expected.authorityId
      || receipt.authorityVersion !== authority.version
    ) {
      return { valid: false, reason: "authority_mismatch" };
    }
    if (
      receipt.tenantId !== expected.tenantId
      || receipt.subjectKind !== expected.subjectKind
      || receipt.subjectId !== expected.subjectId
      || receipt.subjectKind !== authority.subjectKind
    ) {
      return { valid: false, reason: "subject_identity_mismatch" };
    }
    if (receipt.subjectDigest !== sha256(expected.subject)) {
      return { valid: false, reason: "subject_digest_mismatch" };
    }
    if (expected.requiredVerdict && receipt.verdict !== expected.requiredVerdict) {
      return { valid: false, reason: "verdict_mismatch" };
    }

    const { receiptDigest, ...body } = receipt;
    if (!/^[a-f0-9]{64}$/.test(receipt.evidenceDigest || "")) {
      return { valid: false, reason: "evidence_digest_invalid" };
    }
    if (receiptDigest !== sha256(body)) {
      return { valid: false, reason: "receipt_digest_mismatch" };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `invalid_receipt:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function serializeArtifactAuthorityReceipt(receipt: ArtifactAuthorityReceipt): string {
  return `${ARTIFACT_AUTHORITY_RECEIPT_PREFIX}${stableJson(receipt)}`;
}

export function extractArtifactAuthorityReceipt(details: unknown): ArtifactAuthorityReceipt | null {
  if (typeof details !== "string") return null;
  const lines = details
    .split(/\r?\n/)
    .filter((line) => line.startsWith(ARTIFACT_AUTHORITY_RECEIPT_PREFIX));
  if (lines.length !== 1) return null;

  try {
    const parsed = JSON.parse(lines[0].slice(ARTIFACT_AUTHORITY_RECEIPT_PREFIX.length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as ArtifactAuthorityReceipt;
  } catch {
    return null;
  }
}