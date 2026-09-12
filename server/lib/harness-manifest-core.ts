/**
 * Pure content-addressing helpers for a harness snapshot.
 *
 * This module deliberately has no database or runtime imports, so its identity
 * and redaction rules can be tested without opening a pool. The database layer
 * persists only the returned snapshot and hash.
 */

import { createHash } from "node:crypto";

const SECRET_KEY = /(?:api[_-]?key|secret|token|password|cookie|authorization|credential)/i;

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

function normalizeJson(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Harness manifest contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      out[key] = normalizeJson(item);
    }
    return out;
  }
  throw new Error(`Harness manifest contains unsupported ${typeof value} value`);
}

/**
 * Drop secret-shaped properties recursively. Manifests are audit metadata, not
 * a configuration backup; retaining credentials would make provenance storage
 * an unnecessary secrets surface.
 */
export function redactManifestSecrets(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map((item) => redactManifestSecrets(item));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(source)) {
      if (SECRET_KEY.test(key)) continue;
      const item = source[key];
      if (item === undefined) continue;
      out[key] = redactManifestSecrets(item);
    }
    return out;
  }
  return normalizeJson(value);
}

/** Stable serialization for a normalized JSON value. */
export function stableManifestStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export interface BuiltHarnessManifest {
  snapshot: JsonValue;
  canonical: string;
  hash: string;
}

export interface RuntimeHarnessComponents {
  taskInterface: Record<string, unknown>;
  memory: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  router: Record<string, unknown>;
}

export interface ActiveHarnessAddendum {
  id: number;
  modelId: string;
  weakness: string;
  addendum: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface LlmTaskFingerprint {
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  promptTemplateHash: string;
  outputSchemaHash?: string;
}

export type HarnessManifestProfile =
  | {
      kind: "offline-eval";
      goldenSetHash: string;
      goldenSetCaseCount: number;
      hydeEnabled: boolean;
      answer: LlmTaskFingerprint;
      judge: LlmTaskFingerprint;
    }
  | {
      kind: "harness-adaptation";
      modelId: string;
      weakness: string;
      candidateAddendumHash: string;
      proposerModel: string;
      maxCandidateChars: number;
      evidenceWindowDays: number;
      minEvidenceFailures: number;
      heldOutRatio: number;
      splitSeed: number;
      heldOutJudgeModel: string;
      minimumPrevention: number;
      juryRequiredMajority: number;
      taskContracts: {
        proposerPromptHash: string;
        proposerSchemaHash: string;
        heldOutJudgePromptHash: string;
        heldOutJudgeSchemaHash: string;
        validationPolicyHash: string;
        juryContractHash: string;
        proposerExecution: {
          model: string;
          temperature: number;
          maxTokens: number;
          timeoutMs: number;
          requiresTools: boolean;
        };
        heldOutJudgeExecution: {
          model: string;
          temperature: number;
          maxTokens: number;
          timeoutMs: number;
          requiresTools: boolean;
        };
        heldOutSampleCap: number;
        juryExecution: {
          pool: string;
          invokedVia: string;
          meteredOverride: boolean;
          roster: Array<{
            model: string;
            provider: string;
          }>;
        };
      };
    };

/**
 * The only two persisted profile shapes. Unlike a generic settings object,
 * these are an explicit allowlist of non-secret fields that define the
 * evaluation/adaptation harness. Adding a new value is therefore a deliberate
 * reviewable API change rather than an incidental property spread.
 */
export function buildProfiledHarnessManifest(input: {
  schemaVersion: number;
  profile: HarnessManifestProfile;
  activeAddenda: ActiveHarnessAddendum[];
}): BuiltHarnessManifest {
  const { profile } = input;
  if (profile.kind === "offline-eval") {
    return buildRuntimeHarnessManifest({
      schemaVersion: input.schemaVersion,
      purpose: profile.kind,
      activeAddenda: input.activeAddenda,
      components: {
        taskInterface: { answer: profile.answer, judge: profile.judge },
        memory: { hydeEnabled: profile.hydeEnabled, injectedKnowledge: false },
        capabilities: {
          toolExecution: false,
          goldenSet: {
            contentHash: profile.goldenSetHash,
            caseCount: profile.goldenSetCaseCount,
          },
        },
        router: {
          answerModel: profile.answer.model,
          judgeModel: profile.judge.model,
          independentJudge: profile.answer.model !== profile.judge.model,
        },
      },
    });
  }

  return buildRuntimeHarnessManifest({
    schemaVersion: input.schemaVersion,
    purpose: profile.kind,
    activeAddenda: input.activeAddenda,
    components: {
      taskInterface: {
        proposerModel: profile.proposerModel,
        maxCandidateChars: profile.maxCandidateChars,
        contracts: {
          proposerPromptHash: profile.taskContracts.proposerPromptHash,
          proposerSchemaHash: profile.taskContracts.proposerSchemaHash,
          heldOutJudgePromptHash: profile.taskContracts.heldOutJudgePromptHash,
          heldOutJudgeSchemaHash: profile.taskContracts.heldOutJudgeSchemaHash,
          proposerExecution: profile.taskContracts.proposerExecution,
          heldOutJudgeExecution: profile.taskContracts.heldOutJudgeExecution,
          heldOutSampleCap: profile.taskContracts.heldOutSampleCap,
        },
      },
      memory: {
        evidenceWindowDays: profile.evidenceWindowDays,
        minEvidenceFailures: profile.minEvidenceFailures,
        heldOutRatio: profile.heldOutRatio,
        splitSeed: profile.splitSeed,
      },
      capabilities: {
        candidate: {
          modelId: profile.modelId,
          weakness: profile.weakness,
          addendumHash: profile.candidateAddendumHash,
        },
      },
      router: {
        heldOutJudgeModel: profile.heldOutJudgeModel,
        minimumPrevention: profile.minimumPrevention,
        juryRequiredMajority: profile.juryRequiredMajority,
        validationPolicyHash: profile.taskContracts.validationPolicyHash,
        juryContractHash: profile.taskContracts.juryContractHash,
        juryExecution: profile.taskContracts.juryExecution,
      },
    },
  });
}

/**
 * Build the complete persisted provenance shape without retaining raw learned
 * prompt text. This remains pure so callers can prove the privacy boundary in
 * unit tests before the database helper is involved.
 */
export function buildRuntimeHarnessManifest(input: {
  schemaVersion: number;
  purpose: string;
  components: RuntimeHarnessComponents;
  activeAddenda: ActiveHarnessAddendum[];
}): BuiltHarnessManifest {
  const activeModelAddenda = input.activeAddenda.map((addendum) => ({
    id: addendum.id,
    modelId: addendum.modelId,
    weakness: addendum.weakness,
    contentHash: buildHarnessManifest({ addendum: addendum.addendum }).hash,
    createdAt: addendum.createdAt,
    updatedAt: addendum.updatedAt,
  }));
  return buildHarnessManifest({
    schemaVersion: input.schemaVersion,
    purpose: input.purpose,
    taskInterface: input.components.taskInterface,
    memory: input.components.memory,
    capabilities: {
      ...input.components.capabilities,
      activeModelAddenda,
    },
    router: input.components.router,
  });
}

/**
 * Produce a secret-free, canonical snapshot and its full SHA-256 identity.
 * Equal logical snapshots have the same hash regardless of input key order.
 */
export function buildHarnessManifest(input: unknown): BuiltHarnessManifest {
  const snapshot = redactManifestSecrets(input);
  const canonical = stableManifestStringify(snapshot);
  return {
    snapshot,
    canonical,
    hash: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}