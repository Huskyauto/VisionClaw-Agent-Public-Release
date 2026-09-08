import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { scanManagedSkillPromptSafety } from "./managed-skill-safety";
import {
  registerSkillOptimizationCandidate,
  SKILL_OPT_POLICY_VERSION,
  type RegisterCandidateResult,
} from "./skill-optimizer-promotion";

export const PORTABLE_SKILL_BEHAVIOR_FORMAT = "visionclaw.learned-behavior";
export const PORTABLE_SKILL_BEHAVIOR_VERSION = 1;
export const PORTABLE_SKILL_BEHAVIOR_MAX_BYTES = 256 * 1024;
const MAX_CASE_HASHES = 100;
const MAX_LIST_ITEMS = 50;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export interface PortableSkillBehaviorBundleInput {
  sourceTenantId: number;
  audienceTenantId: number;
  label: string;
  name: string;
  description: string;
  seedContent: string;
  candidateContent: string;
  provenance: {
    sourceCandidateIdentity: string;
    sourceHarness: string;
    sourceHarnessVersion: string;
  };
  evaluation: {
    evalSetHash: string;
    policyVersion: string;
    baselineScore: number;
    bestScore: number;
    acceptedEdits: number;
    rejectedEdits: number;
    caseHashes: string[];
  };
  jury: {
    verdict: string;
    majority: number;
    shouldEscalate?: boolean;
    decisionHash: string;
  };
  safety: {
    scannerPolicyVersion: string;
    requiredPolicies: string[];
  };
  compatibility: {
    harnessApiVersion: string;
    requiredCapabilities: string[];
  };
  expiresAt: Date;
  keyId?: string;
}

export interface PortableSkillBehaviorBundle {
  format: typeof PORTABLE_SKILL_BEHAVIOR_FORMAT;
  version: typeof PORTABLE_SKILL_BEHAVIOR_VERSION;
  createdAt: string;
  expiresAt: string;
  sourceTenantId: number;
  audienceTenantId: number;
  label: string;
  behavior: {
    kind: "skill-prompt";
    name: string;
    description: string;
    seedContent: string;
    seedHash: string;
    candidateContent: string;
    candidateHash: string;
  };
  provenance: PortableSkillBehaviorBundleInput["provenance"];
  evaluation: PortableSkillBehaviorBundleInput["evaluation"];
  jury: PortableSkillBehaviorBundleInput["jury"];
  safety: PortableSkillBehaviorBundleInput["safety"];
  compatibility: PortableSkillBehaviorBundleInput["compatibility"];
  rollback: {
    seedContent: string;
    seedHash: string;
  };
  signature: {
    algorithm: "hmac-sha256";
    keyId: string;
    value: string;
  };
}

export interface PortableSkillBehaviorVerificationContext {
  signingKey: string;
  destinationTenantId: number;
  now?: Date;
  harnessApiVersion: string;
  policyVersion: string;
  scannerPolicyVersion: string;
  capabilities: string[];
}

export interface PortableSkillBehaviorVerification {
  ok: boolean;
  reason?: string;
  bundle?: PortableSkillBehaviorBundle;
}

export interface PortableSkillBehaviorImportContext
  extends PortableSkillBehaviorVerificationContext {
  registerCandidate?: typeof registerSkillOptimizationCandidate;
}

export interface PortableSkillBehaviorImportResult {
  ok: boolean;
  reason?: string;
  candidate?: RegisterCandidateResult;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalizePortableBehavior(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizePortableBehavior).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalizePortableBehavior(record[key])}`,
  ).join(",")}}`;
}

function requireSigningKey(signingKey: string): void {
  if (typeof signingKey !== "string" || signingKey.length < 32) {
    throw new Error("portable behavior: signing key must contain at least 32 characters");
  }
}

function requirePositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`portable behavior: ${name} must be a positive integer`);
  }
}

function requireNonEmpty(value: string, name: string, max = 20_000): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`portable behavior: ${name} is required`);
  }
  if (Buffer.byteLength(value, "utf8") > max) {
    throw new Error(`portable behavior: ${name} exceeds the size limit`);
  }
}

function unsignedBundle(bundle: PortableSkillBehaviorBundle): Omit<PortableSkillBehaviorBundle, "signature"> {
  const { signature: _signature, ...unsigned } = bundle;
  return unsigned;
}

function signUnsigned(
  unsigned: Omit<PortableSkillBehaviorBundle, "signature">,
  signingKey: string,
): string {
  return createHmac("sha256", signingKey)
    .update(canonicalizePortableBehavior(unsigned), "utf8")
    .digest("hex");
}

function safeHexEqual(left: string, right: string): boolean {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function finiteScore(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`portable behavior: ${name} must be within 0..1`);
  }
}

export function createPortableSkillBehaviorBundle(
  input: PortableSkillBehaviorBundleInput,
  signingKey: string,
  now = new Date(),
): PortableSkillBehaviorBundle {
  requireSigningKey(signingKey);
  requirePositiveInt(input.sourceTenantId, "sourceTenantId");
  requirePositiveInt(input.audienceTenantId, "audienceTenantId");
  requireNonEmpty(input.label, "label", 500);
  requireNonEmpty(input.name, "name", 500);
  requireNonEmpty(input.description, "description", 4_000);
  requireNonEmpty(input.seedContent, "seedContent", 100_000);
  requireNonEmpty(input.candidateContent, "candidateContent", 100_000);
  requireNonEmpty(input.provenance.sourceCandidateIdentity, "sourceCandidateIdentity", 1_000);
  requireNonEmpty(input.provenance.sourceHarness, "sourceHarness", 200);
  requireNonEmpty(input.provenance.sourceHarnessVersion, "sourceHarnessVersion", 200);
  requireNonEmpty(input.evaluation.policyVersion, "policyVersion", 200);
  requireNonEmpty(input.safety.scannerPolicyVersion, "scannerPolicyVersion", 200);
  requireNonEmpty(input.compatibility.harnessApiVersion, "harnessApiVersion", 100);
  if (!SHA256_HEX.test(input.evaluation.evalSetHash)) {
    throw new Error("portable behavior: evalSetHash must be a SHA-256 hex digest");
  }
  if (!SHA256_HEX.test(input.jury.decisionHash)) {
    throw new Error("portable behavior: jury decisionHash must be a SHA-256 hex digest");
  }
  finiteScore(input.evaluation.baselineScore, "baselineScore");
  finiteScore(input.evaluation.bestScore, "bestScore");
  if (input.evaluation.bestScore <= input.evaluation.baselineScore) {
    throw new Error("portable behavior: evaluation must show a strict improvement");
  }
  if (!Number.isInteger(input.evaluation.acceptedEdits) || input.evaluation.acceptedEdits < 1 ||
      !Number.isInteger(input.evaluation.rejectedEdits) || input.evaluation.rejectedEdits < 0) {
    throw new Error("portable behavior: evaluation edit counts are malformed");
  }
  if (input.evaluation.caseHashes.length > MAX_CASE_HASHES ||
      !input.evaluation.caseHashes.every((hash) => SHA256_HEX.test(hash))) {
    throw new Error("portable behavior: caseHashes are malformed or exceed the limit");
  }
  if (!Number.isInteger(input.jury.majority) || input.jury.majority < 0 || input.jury.majority > 3) {
    throw new Error("portable behavior: jury majority must be an integer within 0..3");
  }
  for (const [name, list] of [
    ["requiredPolicies", input.safety.requiredPolicies],
    ["requiredCapabilities", input.compatibility.requiredCapabilities],
  ] as const) {
    if (!Array.isArray(list) || list.length > MAX_LIST_ITEMS ||
        !list.every((item) => typeof item === "string" && item.trim() && item.length <= 200)) {
      throw new Error(`portable behavior: ${name} are malformed or exceed the limit`);
    }
  }
  if (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) ||
      input.expiresAt.getTime() <= now.getTime()) {
    throw new Error("portable behavior: expiresAt must be in the future");
  }

  const seedHash = sha256(input.seedContent);
  const candidateHash = sha256(input.candidateContent);
  const unsigned: Omit<PortableSkillBehaviorBundle, "signature"> = {
    format: PORTABLE_SKILL_BEHAVIOR_FORMAT,
    version: PORTABLE_SKILL_BEHAVIOR_VERSION,
    createdAt: now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    sourceTenantId: input.sourceTenantId,
    audienceTenantId: input.audienceTenantId,
    label: input.label.trim(),
    behavior: {
      kind: "skill-prompt",
      name: input.name.trim(),
      description: input.description.trim(),
      seedContent: input.seedContent,
      seedHash,
      candidateContent: input.candidateContent,
      candidateHash,
    },
    provenance: { ...input.provenance },
    evaluation: {
      ...input.evaluation,
      caseHashes: [...input.evaluation.caseHashes],
    },
    jury: { ...input.jury },
    safety: {
      ...input.safety,
      requiredPolicies: [...new Set(input.safety.requiredPolicies)].sort(),
    },
    compatibility: {
      ...input.compatibility,
      requiredCapabilities: [...new Set(input.compatibility.requiredCapabilities)].sort(),
    },
    rollback: { seedContent: input.seedContent, seedHash },
  };
  if (Buffer.byteLength(canonicalizePortableBehavior(unsigned), "utf8") > PORTABLE_SKILL_BEHAVIOR_MAX_BYTES) {
    throw new Error("portable behavior: bundle exceeds the size limit");
  }
  return {
    ...unsigned,
    signature: {
      algorithm: "hmac-sha256",
      keyId: input.keyId?.trim() || "session-secret-v1",
      value: signUnsigned(unsigned, signingKey),
    },
  };
}

export function verifyPortableSkillBehaviorBundle(
  value: unknown,
  context: PortableSkillBehaviorVerificationContext,
): PortableSkillBehaviorVerification {
  try {
    requireSigningKey(context.signingKey);
    requirePositiveInt(context.destinationTenantId, "destinationTenantId");
    requireNonEmpty(context.harnessApiVersion, "destination harnessApiVersion", 100);
    requireNonEmpty(context.policyVersion, "destination policyVersion", 200);
    requireNonEmpty(context.scannerPolicyVersion, "destination scannerPolicyVersion", 200);
    if (!Array.isArray(context.capabilities) ||
        context.capabilities.length > MAX_LIST_ITEMS ||
        !context.capabilities.every((item) =>
          typeof item === "string" && item.trim() && item.length <= 200
        )) {
      return { ok: false, reason: "portable behavior destination capabilities are malformed" };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: "portable behavior bundle is missing or malformed" };
    }
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > PORTABLE_SKILL_BEHAVIOR_MAX_BYTES) {
      return { ok: false, reason: "portable behavior bundle exceeds the size limit" };
    }
    const bundle = value as PortableSkillBehaviorBundle;
    if (bundle.format !== PORTABLE_SKILL_BEHAVIOR_FORMAT ||
        bundle.version !== PORTABLE_SKILL_BEHAVIOR_VERSION) {
      return { ok: false, reason: "portable behavior format or version is unsupported" };
    }
    if (!bundle.signature || bundle.signature.algorithm !== "hmac-sha256" ||
        typeof bundle.signature.value !== "string") {
      return { ok: false, reason: "portable behavior signature is missing or malformed" };
    }
    const expectedSignature = signUnsigned(unsignedBundle(bundle), context.signingKey);
    if (!safeHexEqual(bundle.signature.value, expectedSignature)) {
      return { ok: false, reason: "portable behavior signature verification failed" };
    }
    requirePositiveInt(bundle.sourceTenantId, "sourceTenantId");
    requirePositiveInt(bundle.audienceTenantId, "audienceTenantId");
    requireNonEmpty(bundle.label, "label", 500);
    requireNonEmpty(bundle.provenance?.sourceCandidateIdentity, "sourceCandidateIdentity", 1_000);
    requireNonEmpty(bundle.provenance?.sourceHarness, "sourceHarness", 200);
    requireNonEmpty(bundle.provenance?.sourceHarnessVersion, "sourceHarnessVersion", 200);
    if (bundle.audienceTenantId !== context.destinationTenantId) {
      return { ok: false, reason: "portable behavior destination tenant does not match signed audience" };
    }
    const now = context.now ?? new Date();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      return { ok: false, reason: "portable behavior verification clock is invalid" };
    }
    const createdAt = Date.parse(bundle.createdAt);
    const expiresAt = Date.parse(bundle.expiresAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) ||
        expiresAt <= now.getTime() || createdAt > now.getTime() + 5 * 60_000 ||
        expiresAt <= createdAt) {
      return { ok: false, reason: "portable behavior bundle is expired or has invalid timestamps" };
    }
    if (!bundle.behavior || bundle.behavior.kind !== "skill-prompt") {
      return { ok: false, reason: "portable behavior content is missing or malformed" };
    }
    requireNonEmpty(bundle.behavior.name, "name", 500);
    requireNonEmpty(bundle.behavior.description, "description", 4_000);
    requireNonEmpty(bundle.behavior.seedContent, "seedContent", 100_000);
    requireNonEmpty(bundle.behavior.candidateContent, "candidateContent", 100_000);
    if (
        bundle.behavior.seedHash !== sha256(bundle.behavior.seedContent) ||
        bundle.behavior.candidateHash !== sha256(bundle.behavior.candidateContent) ||
        !bundle.rollback || bundle.rollback.seedContent !== bundle.behavior.seedContent ||
        bundle.rollback.seedHash !== bundle.behavior.seedHash) {
      return { ok: false, reason: "portable behavior content or rollback hash verification failed" };
    }
    if (!bundle.evaluation || !SHA256_HEX.test(bundle.evaluation.evalSetHash) ||
        bundle.evaluation.policyVersion !== context.policyVersion ||
        bundle.evaluation.policyVersion !== SKILL_OPT_POLICY_VERSION) {
      return { ok: false, reason: "portable behavior evaluation policy is incompatible" };
    }
    finiteScore(bundle.evaluation.baselineScore, "baselineScore");
    finiteScore(bundle.evaluation.bestScore, "bestScore");
    if (bundle.evaluation.bestScore <= bundle.evaluation.baselineScore ||
        !Number.isInteger(bundle.evaluation.acceptedEdits) ||
        bundle.evaluation.acceptedEdits < 1 ||
        !Number.isInteger(bundle.evaluation.rejectedEdits) ||
        bundle.evaluation.rejectedEdits < 0 ||
        !Array.isArray(bundle.evaluation.caseHashes) ||
        bundle.evaluation.caseHashes.length > MAX_CASE_HASHES ||
        !bundle.evaluation.caseHashes.every((hash) => SHA256_HEX.test(hash))) {
      return { ok: false, reason: "portable behavior evaluation evidence is malformed" };
    }
    if (!bundle.jury || !SHA256_HEX.test(bundle.jury.decisionHash) ||
        typeof bundle.jury.verdict !== "string" || !bundle.jury.verdict.trim() ||
        !Number.isInteger(bundle.jury.majority) ||
        bundle.jury.majority < 0 || bundle.jury.majority > 3 ||
        (bundle.jury.shouldEscalate !== undefined && typeof bundle.jury.shouldEscalate !== "boolean")) {
      return { ok: false, reason: "portable behavior jury provenance is malformed" };
    }
    if (!bundle.compatibility) {
      return { ok: false, reason: "portable behavior compatibility metadata is missing" };
    }
    requireNonEmpty(bundle.compatibility.harnessApiVersion, "bundle harnessApiVersion", 100);
    if (bundle.compatibility.harnessApiVersion !== context.harnessApiVersion ||
        !Array.isArray(bundle.compatibility.requiredCapabilities) ||
        bundle.compatibility.requiredCapabilities.length > MAX_LIST_ITEMS ||
        !bundle.compatibility.requiredCapabilities.every((item) =>
          typeof item === "string" && item.trim() && item.length <= 200
        )) {
      return { ok: false, reason: "portable behavior harness API is incompatible" };
    }
    const available = new Set(context.capabilities);
    const missing = bundle.compatibility.requiredCapabilities.filter((item) => !available.has(item));
    if (missing.length > 0) {
      return { ok: false, reason: `portable behavior requires unavailable capabilities: ${missing.join(", ")}` };
    }
    if (!bundle.safety) {
      return { ok: false, reason: "portable behavior safety metadata is missing" };
    }
    requireNonEmpty(bundle.safety.scannerPolicyVersion, "bundle scannerPolicyVersion", 200);
    if (bundle.safety.scannerPolicyVersion !== context.scannerPolicyVersion ||
        !Array.isArray(bundle.safety.requiredPolicies) ||
        bundle.safety.requiredPolicies.length === 0 ||
        bundle.safety.requiredPolicies.length > MAX_LIST_ITEMS ||
        !bundle.safety.requiredPolicies.every((item) =>
          typeof item === "string" && item.trim() && item.length <= 200
        ) ||
        !bundle.safety.requiredPolicies.includes("managed-skill-safety") ||
        !bundle.safety.requiredPolicies.includes("skill-optimizer-promotion")) {
      return { ok: false, reason: "portable behavior scanner policy or safety dependencies are incompatible" };
    }
    return { ok: true, bundle };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "portable behavior verification failed",
    };
  }
}

export async function importPortableSkillBehaviorBundle(
  value: unknown,
  context: PortableSkillBehaviorImportContext,
): Promise<PortableSkillBehaviorImportResult> {
  const verified = verifyPortableSkillBehaviorBundle(value, context);
  if (!verified.ok || !verified.bundle) return { ok: false, reason: verified.reason };
  const bundle = verified.bundle;
  const safety = scanManagedSkillPromptSafety({
    name: bundle.behavior.name,
    description: bundle.behavior.description,
    promptContent: bundle.behavior.candidateContent,
  });
  if (!safety.safe) {
    return {
      ok: false,
      reason: `portable behavior content failed destination safety scan (${safety.patterns.join(", ")})`,
    };
  }
  const register = context.registerCandidate || registerSkillOptimizationCandidate;
  const candidate = await register({
    tenantId: context.destinationTenantId,
    skillId: null,
    label: bundle.label,
    seedContent: bundle.behavior.seedContent,
    candidateContent: bundle.behavior.candidateContent,
    evalSetHash: bundle.evaluation.evalSetHash,
    source: "manual",
    name: bundle.behavior.name,
    description: bundle.behavior.description,
    evidence: {
      baselineScore: bundle.evaluation.baselineScore,
      bestScore: bundle.evaluation.bestScore,
      acceptedEdits: bundle.evaluation.acceptedEdits,
      rejectedEdits: bundle.evaluation.rejectedEdits,
      portableBundle: bundle,
      importedJuryProvenanceOnly: bundle.jury,
      importAttestation: {
        verifiedAt: (context.now || new Date()).toISOString(),
        sourceTenantId: bundle.sourceTenantId,
        audienceTenantId: bundle.audienceTenantId,
        foreignApprovalTrusted: false,
        destinationSafetyScan: safety,
      },
    },
  });
  if (candidate.candidateHash !== bundle.behavior.candidateHash ||
      candidate.seedHash !== bundle.behavior.seedHash) {
    return {
      ok: false,
      reason: "portable behavior persisted candidate hashes do not match the signed bundle",
    };
  }
  if (candidate.state !== "proposed" && candidate.state !== "held") {
    return {
      ok: false,
      reason: `portable behavior import did not enter review quarantine (state=${candidate.state})`,
    };
  }
  return { ok: true, candidate };
}