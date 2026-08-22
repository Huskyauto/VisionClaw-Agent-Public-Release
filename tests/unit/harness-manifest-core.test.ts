import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHarnessManifest,
  buildProfiledHarnessManifest,
  buildRuntimeHarnessManifest,
  redactManifestSecrets,
} from "../../server/lib/harness-manifest-core";

describe("harness manifest core", () => {
  it("assigns one stable hash to semantically identical component snapshots", () => {
    const a = buildHarnessManifest({
      schemaVersion: 1,
      taskInterface: { model: "gpt-5-mini", output: "json" },
      memory: { hydeEnabled: true },
      capabilities: { activeAddenda: [{ id: 7, contentHash: "abc" }] },
      router: { strategy: "direct" },
    });
    const b = buildHarnessManifest({
      router: { strategy: "direct" },
      capabilities: { activeAddenda: [{ contentHash: "abc", id: 7 }] },
      memory: { hydeEnabled: true },
      taskInterface: { output: "json", model: "gpt-5-mini" },
      schemaVersion: 1,
    });

    assert.equal(a.hash, b.hash);
    assert.deepEqual(a.snapshot, b.snapshot);
  });

  it("redacts secret-shaped keys before persisting or hashing a snapshot", () => {
    const clean = redactManifestSecrets({
      model: "gpt-5-mini",
      apiKey: "should-never-persist",
      nested: { authorization: "Bearer should-never-persist", enabled: true },
    });

    assert.deepEqual(clean, {
      model: "gpt-5-mini",
      nested: { enabled: true },
    });
    assert.doesNotMatch(JSON.stringify(buildHarnessManifest(clean).snapshot), /should-never-persist/);
  });

  it("does not mutate the caller-owned snapshot", () => {
    const input = {
      schemaVersion: 1,
      taskInterface: { model: "gpt-5-mini" },
      memory: { hydeEnabled: true },
      capabilities: { apiKey: "redact-me" },
      router: { strategy: "direct" },
    };

    buildHarnessManifest(input);

    assert.equal(input.capabilities.apiKey, "redact-me");
  });

  it("records active learned addenda as content hashes rather than prompt text", () => {
    const privateAddendum = "Internal operating note that must remain in the delta record.";
    const manifest = buildRuntimeHarnessManifest({
      schemaVersion: 1,
      purpose: "offline-eval",
      components: {
        taskInterface: { model: "gpt-5-mini" },
        memory: { hydeEnabled: true },
        capabilities: {},
        router: { strategy: "direct" },
      },
      activeAddenda: [{
        id: 9,
        modelId: "gpt-5-mini",
        weakness: "json",
        addendum: privateAddendum,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: null,
      }],
    });
    const encoded = JSON.stringify(manifest.snapshot);

    assert.doesNotMatch(encoded, /Internal operating note/);
    assert.match(encoded, /contentHash/);
  });

  it("changes the offline-eval identity when the golden-set digest changes", () => {
    const shared = {
      schemaVersion: 1,
      activeAddenda: [],
      profile: {
        kind: "offline-eval" as const,
        goldenSetCaseCount: 2,
        hydeEnabled: true,
        answer: {
          model: "gpt-5-mini",
          temperature: 0.2,
          maxTokens: 1200,
          timeoutMs: 45_000,
          promptTemplateHash: "answer-contract-v1",
        },
        judge: {
          model: "gpt-5-nano",
          temperature: 0,
          maxTokens: 1500,
          timeoutMs: 45_000,
          promptTemplateHash: "judge-contract-v1",
          outputSchemaHash: "judge-schema-v1",
        },
      },
    };
    const a = buildProfiledHarnessManifest({
      ...shared,
      profile: { ...shared.profile, goldenSetHash: "golden-set-a" },
    });
    const b = buildProfiledHarnessManifest({
      ...shared,
      profile: { ...shared.profile, goldenSetHash: "golden-set-b" },
    });

    assert.notEqual(a.hash, b.hash);
  });

  it("changes an adaptation identity when any decision contract changes", () => {
    const shared = {
      schemaVersion: 1,
      activeAddenda: [],
      profile: {
        kind: "harness-adaptation" as const,
        modelId: "gpt-5-mini",
        weakness: "missing tool selection",
        candidateAddendumHash: "candidate-v1",
        proposerModel: "gpt-5-mini",
        maxCandidateChars: 600,
        evidenceWindowDays: 14,
        minEvidenceFailures: 6,
        heldOutRatio: 0.4,
        splitSeed: 0x5e1f,
        heldOutJudgeModel: "gpt-5-mini",
        minimumPrevention: 0.5,
        juryRequiredMajority: 2,
        taskContracts: {
          proposerPromptHash: "proposer-v1",
          proposerSchemaHash: "proposer-schema-v1",
          heldOutJudgePromptHash: "judge-v1",
          heldOutJudgeSchemaHash: "judge-schema-v1",
          validationPolicyHash: "validator-v1",
          juryContractHash: "jury-v1",
        },
      },
    };
    const a = buildProfiledHarnessManifest(shared as any);
    const b = buildProfiledHarnessManifest({
      ...shared,
      profile: {
        ...shared.profile,
        taskContracts: {
          ...shared.profile.taskContracts,
          juryContractHash: "jury-v2",
        },
      },
    } as any);

    assert.notEqual(a.hash, b.hash);
  });

  it("changes an adaptation identity when execution policy changes", () => {
    const shared = {
      schemaVersion: 1,
      activeAddenda: [],
      profile: {
        kind: "harness-adaptation" as const,
        modelId: "gpt-5-mini",
        weakness: "missing tool selection",
        candidateAddendumHash: "candidate-v1",
        proposerModel: "gpt-5-mini",
        maxCandidateChars: 600,
        evidenceWindowDays: 14,
        minEvidenceFailures: 6,
        heldOutRatio: 0.4,
        splitSeed: 0x5e1f,
        heldOutJudgeModel: "gpt-5-mini",
        minimumPrevention: 0.5,
        juryRequiredMajority: 2,
        taskContracts: {
          proposerPromptHash: "proposer-v1",
          proposerSchemaHash: "proposer-schema-v1",
          heldOutJudgePromptHash: "judge-v1",
          heldOutJudgeSchemaHash: "judge-schema-v1",
          validationPolicyHash: "validator-v1",
          juryContractHash: "jury-v1",
          proposerExecution: { temperature: 0.3, maxTokens: 1200, timeoutMs: 60_000 },
          heldOutJudgeExecution: { temperature: 0.1, maxTokens: 1200, timeoutMs: 60_000 },
          heldOutSampleCap: 12,
          juryExecution: {
            pool: "frontier",
            invokedVia: "harness-adaptation-nightly",
            meteredOverride: false,
            roster: [{ model: "gpt-5-mini", provider: "openai" }],
          },
        },
      },
    };
    const a = buildProfiledHarnessManifest(shared as any);
    const variants = [
      {
        ...shared.profile.taskContracts,
        proposerExecution: { ...shared.profile.taskContracts.proposerExecution, temperature: 0.4 },
      },
      {
        ...shared.profile.taskContracts,
        heldOutJudgeExecution: { ...shared.profile.taskContracts.heldOutJudgeExecution, timeoutMs: 30_000 },
      },
      { ...shared.profile.taskContracts, heldOutSampleCap: 24 },
      {
        ...shared.profile.taskContracts,
        juryExecution: {
          ...shared.profile.taskContracts.juryExecution,
          roster: [{ model: "gpt-5.5", provider: "openai" }],
        },
      },
    ];

    for (const taskContracts of variants) {
      const changed = buildProfiledHarnessManifest({
        ...shared,
        profile: { ...shared.profile, taskContracts },
      } as any);
      assert.notEqual(a.hash, changed.hash);
    }
    assert.deepEqual(
      a.snapshot.router.juryExecution.roster,
      [{ model: "gpt-5-mini", provider: "openai" }],
    );
  });
});