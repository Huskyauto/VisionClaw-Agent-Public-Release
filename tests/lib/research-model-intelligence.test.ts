import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MODEL_INTELLIGENCE_PROGRAM, admitsResearchCodeProposal, configuredAnthropicResearchKey, confirmsResearchModel, parseAnthropicActiveModels,
  researchModelDigestEvidence, selectRecentAnthropicModels,
} from "../../server/lib/research-model-intelligence";

test("discovery selects only recent provider-confirmed snapshots absent from the registry", () => {
  const now = Date.parse("2026-11-22T18:00:00Z");
  const row = (id: string, date: string) => ({ id, created_at: `${date}T00:00:00Z`, type: "model" });
  const models = [
    row("claude-sonnet-5-9-20261110", "2026-11-10"),
    row("claude-haiku-5-1-20261105", "2026-11-05"),
    row("claude-opus-5-9-20261015", "2026-10-15"),
    row("claude-3-7-sonnet-20250219", "2025-02-19"),
    row("claude-sonnet-5-9-latest", "2026-11-19"),
    row("claude-haiku-5-8-20250507", "2026-11-17"),
    row("claude-opus-5-8-20261130", "2026-11-30"),
    row("claude-fable-5-9", "2026-11-12"),
    row("claude-haiku-5-9", "2026-11-14"),
    { id: "claude-opus-5-9-20261016", type: "model" },
  ];
  assert.deepEqual(selectRecentAnthropicModels(models, new Set(models.map(x => x.id).filter(id => id !== "claude-haiku-5-9")), ["anthropic/claude-haiku-5-1-latest"],
    ["claude-opus-5-9-20261015"], now).map(x => [x.id, x.releaseDate]),
  [["claude-fable-5-9", "2026-11-12"], ["claude-sonnet-5-9-20261110", "2026-11-10"]]);
});

test("only affirmative official lifecycle rows qualify and a changed format fails closed", () => {
  const header = "## Model status\n\n| API model name | Current state | Deprecated | Tentative retirement date |\n| :---- | :---- | :---- | :---- |";
  const lifecycle = `${header}\n| claude-opus-5-9 | Active | N/A | In the future |\n| claude-sonnet-5-8 | Deprecated | Today | Next month |\n| claude-haiku-5-7 | Retired | Last month | Today |\n\n## Deprecation history`;
  assert.deepEqual([...parseAnthropicActiveModels(lifecycle) ?? []], ["claude-opus-5-9"]);
  assert.equal(parseAnthropicActiveModels(lifecycle.replace("Current state", "Other column")), null);
  assert.equal(parseAnthropicActiveModels(lifecycle.replace("Deprecated | Today", "Unknown | Today")), null);
  assert.equal(parseAnthropicActiveModels(lifecycle.replace("claude-sonnet-5-8", "claude-opus-5-9")), null);
});

test("catalog uses the existing direct-token precedence, not proxy credentials", () => {
  assert.equal(configuredAnthropicResearchKey({ ANTHROPIC_API_TOKEN: " sk-ant-fixture-token " }), "sk-ant-fixture-token");
  assert.equal(configuredAnthropicResearchKey({ ANTHROPIC_API_KEY: "sk-ant-fixture-key" }), "sk-ant-fixture-key");
  assert.equal(configuredAnthropicResearchKey({ ANTHROPIC_API_TOKEN: "wrong-scheme", ANTHROPIC_API_KEY: "sk-ant-fixture-key" }), null);
});

test("a top finding must have recorded first-party evidence to appear in the digest", () => {
  const details = {
    mode: "provider_active_release", provider: "anthropic", id: "claude-opus-5-9", releaseDate: "2026-11-20",
    sourceUrl: "https://api.anthropic.com/v1/models",
    lifecycleUrl: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
    registryReview: "queued", performanceVerified: false,
  };
  assert.deepEqual(researchModelDigestEvidence(JSON.stringify(details)), {
    id: details.id, releaseDate: details.releaseDate, sourceUrl: details.sourceUrl, lifecycleUrl: details.lifecycleUrl,
  });
  for (const value of [null, "MODEL_ID: claude-opus-5-9", JSON.stringify({ ...details, registryReview: "write_failed" }),
    JSON.stringify({ ...details, sourceUrl: "https://example.com" }), JSON.stringify({ ...details, releaseDate: "2026-02-30" })]) {
    assert.equal(researchModelDigestEvidence(value), null);
  }
});

test("model analysis cannot choose its own identifier or reach automatic code generation", () => {
  const id = "claude-sonnet-5-9-20261110";
  assert.equal(confirmsResearchModel(`MODEL_ID: ${id}\nPotential fit: code review.`, id), true);
  assert.equal(confirmsResearchModel(`MODEL_ID: ${id}\nMODEL_ID: old-model`, id), false);
  assert.equal(confirmsResearchModel("MODEL_ID: openai/gpt-4.1", id), false);
  assert.equal(confirmsResearchModel(`MODEL_ID: ${id}-invented`, id), false);
  assert.equal(admitsResearchCodeProposal(MODEL_INTELLIGENCE_PROGRAM), false);
  assert.equal(admitsResearchCodeProposal("Nightly AI Tools & Techniques Scanner"), true);
});

test("the named scanner selects trusted evidence before inference and blocks legacy proposal dispatch and replay", () => {
  const engine = readFileSync(new URL("../../server/research-engine.ts", import.meta.url), "utf8");
  const experiment = engine.slice(engine.indexOf("async function runExperiment("));
  assert.match(experiment, /loadResearchModelCandidates[\s\S]+if \(!modelCandidate\)[\s\S]+await endSession[\s\S]+claimAutonomousBudget[\s\S]+chat\.completions\.create/);
  assert.match(experiment, /const modelIdentityVerified[\s\S]+if \(modelIdentityVerified\) try/);
  assert.match(experiment, /registryReview = await queueResearchModelCandidate[\s\S]+registryReview !== "queued" && registryReview !== "already_recorded"[\s\S]+score = 5;[\s\S]+const verdict/);
  const proposals = readFileSync(new URL("../../server/research-proposals.ts", import.meta.url), "utf8");
  assert.match(proposals, /if \(!admitsResearchCodeProposal\(args\[1\]\)\) return null;[\s\S]*withHeavyWorkLane/);
  assert.match(proposals, /AND rp\.name <> \$\{MODEL_INTELLIGENCE_PROGRAM\}/);
});
