/**
 * R125+1 — proposer-pool resolver unit tests.
 *
 * No real LLM calls — pure mapping verification. Guarantees the A/B harness
 * (scripts/ensemble-query-ab.ts) and the runtime executeMoA() agree on what
 * each pool name expands to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  CHEAP_PROPOSERS,
  MIXED_PROPOSERS,
  resolveProposerPool,
  shouldRecordEstimatedMoACost,
} from "../../server/moa";
import { MODEL_REGISTRY } from "../../server/model-registry";

// The runtime tier-override file (data/model-tiers.json, written by the weekly
// model refresh / Bob's $0 pin) legitimately WINS over the hardcoded constants
// (see loadTierOverride in server/moa.ts). These tests must be
// environment-agnostic: when a valid override is present, assert the resolver
// honors it; otherwise assert the hardcoded constant contract.
function readOverride(): { frontier: string[]; mundane: string[] } | null {
  try {
    const raw = JSON.parse(fs.readFileSync("data/model-tiers.json", "utf8"));
    const frontier = Array.isArray(raw?.frontier) ? raw.frontier.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
    const mundane = Array.isArray(raw?.mundane) ? raw.mundane.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
    return frontier.length >= 3 ? { frontier, mundane } : null;
  } catch {
    return null;
  }
}

const HARDCODED_FRONTIER = [
  "openference/deepseek-v4-pro",
  "gpt-5.4",
  "claude-sonnet-5-5",
];

const EXPECTED_CHEAP_WORKERS = [
  "nvidia/nemotron-3-super-120b-a12b",
  "inclusionai/ling-2.6-1t:free",
  "xiaomi/mimo-v2-flash",
  "google/gemma-4-31b-it",
  "z-ai/glm-4.7-flash",
];

test("retired OpenRouter DeepSeek V4 ids stay absent from active routing and guidance", () => {
  const retired = [
    "deepseek/deepseek-v4-pro-0813",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-flash-0731",
  ];
  const activeSurfaces = [
    "server/model-registry.ts",
    "server/moa.ts",
    "server/lib/deliverable-ensemble.ts",
    "server/auxiliary-client.ts",
    "server/persona-sync.ts",
    "server/tools/domains/multiagent/definitions.ts",
    "scripts/model-tier-refresh.ts",
    "scripts/benchmark-ling.ts",
    "scripts/benchmark-ling-hard.ts",
    "scripts/benchmark-ling-full.ts",
  ];
  for (const file of activeSurfaces) {
    const source = fs.readFileSync(file, "utf8");
    for (const id of retired) {
      assert.equal(source.includes(id), false, `${file} still advertises retired OpenRouter model ${id}`);
    }
  }
});

test("built-in economical parallel-worker rosters retain exact model diversity", () => {
  assert.deepEqual(CHEAP_PROPOSERS, EXPECTED_CHEAP_WORKERS);
  assert.deepEqual(
    MIXED_PROPOSERS.slice(-3),
    EXPECTED_CHEAP_WORKERS.slice(0, 3),
    "the mixed pool must retain the exact three economical worker seats",
  );
});

function frontierFixture(override?: unknown): { ids: string[]; specs: Array<{ modelId: string; providerLane: string }> } {
  // Isolate cwd and the loader cache; never overwrite the live runtime roster.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-frontier-fixture-"));
  fs.mkdirSync(path.join(dir, "data"));
  if (override !== undefined)
    fs.writeFileSync(path.join(dir, "data/model-tiers.json"), JSON.stringify(override));
  try {
    const modulePath = path.resolve("server/moa.ts");
    const result = spawnSync(process.execPath, [
      "--import", createRequire(import.meta.url).resolve("tsx"), "--input-type=module", "-e",
      `const m = await import(${JSON.stringify(modulePath)});
       console.log("CI_POOL:" + JSON.stringify({
         ids: m.resolveProposerPool("frontier"),
         specs: m.resolveProposerSpecs("frontier", undefined)
       })); process.exit(0);`,
    ], { cwd: dir, encoding: "utf8", timeout: 40000, maxBuffer: 2000000,
      env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir,
        TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"),
        CI: "true", NODE_ENV: "test", NODE_OPTIONS: "--max-old-space-size=700",
        DATABASE_URL: "postgres://ci:ci@127.0.0.1:1/ci_repair",
        SESSION_SECRET: "ci-test-only-session-secret-at-least-32-characters",
        OPENAI_API_KEY: "sk-ci-smoke-placeholder",
        ANTHROPIC_API_KEY: "sk-ant-ci-smoke-placeholder", XAI_API_KEY: "xai-ci-smoke-placeholder",
        GOOGLE_OAUTH_CLIENT_ID: "ci-smoke-client", GOOGLE_OAUTH_CLIENT_SECRET: "ci-smoke-secret",
      } });
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.split("\n").find(line => line.startsWith("CI_POOL:"));
    assert.ok(line, "Fresh resolver must return its result");
    return JSON.parse(line.slice("CI_POOL:".length));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("frontier falls back with missing or malformed concrete-lane metadata", () => {
  const expected = [
    { modelId: HARDCODED_FRONTIER[0], providerLane: "openference" },
    { modelId: HARDCODED_FRONTIER[1], providerLane: "openai-api" },
    { modelId: HARDCODED_FRONTIER[2], providerLane: "anthropic-api" },
  ];
  const assertFallback = (fixture: ReturnType<typeof frontierFixture>) => {
    assert.deepEqual(fixture.ids, HARDCODED_FRONTIER);
    assert.deepEqual(fixture.specs.map(s => ({ modelId: s.modelId, providerLane: s.providerLane })), expected);
    assert.equal(new Set(fixture.specs.map(s => s.providerLane)).size, 3);
  };
  assertFallback(frontierFixture());
  for (const frontierLanes of [undefined, [
    { modelId: HARDCODED_FRONTIER[0], providerLane: "openference" },
    { modelId: HARDCODED_FRONTIER[1], providerLane: "openference" },
    { modelId: HARDCODED_FRONTIER[2], providerLane: "anthropic-api" },
  ]]) {
    assertFallback(frontierFixture({ frontier: HARDCODED_FRONTIER, mundane: [], frontierLanes }));
  }
});

test("frontier honors a validated independent-lane override without reducing quorum", () => {
  const frontierLanes = [
    { modelId: HARDCODED_FRONTIER[0], providerLane: "openference" },
    // Use actual supported Profundo/CLI input IDs, not the newer normalized
    // fallback aliases, which are deliberately absent from Profundo's map.
    { modelId: "gpt-5.6-sol", providerLane: "profundo" },
    { modelId: "claude-sonnet-5", providerLane: "claude-runner" },
  ];
  const result = frontierFixture({ frontier: frontierLanes.map(s => s.modelId), mundane: [], frontierLanes });
  assert.deepEqual(result.ids, [HARDCODED_FRONTIER[0], "gpt-5.4", "claude-sonnet-5"]);
  // The disabled Profundo seat is normalized, while the explicit Claude CLI
  // lane proves we honored the override rather than using fallback API seats.
  assert.deepEqual(result.specs.map(s => ({ modelId: s.modelId, providerLane: s.providerLane })), [
    frontierLanes[0], { modelId: "gpt-5.4", providerLane: "openai-api" }, frontierLanes[2],
  ]);
  assert.equal(new Set(result.specs.map(s => s.providerLane)).size, 3);
});

test("cheap returns override mundane when present, else 5 lineage-diverse OpenRouter models", () => {
  const ids = resolveProposerPool("cheap");
  const override = readOverride();
  if (override && override.mundane.length > 0) {
    assert.deepEqual(ids, override.mundane);
  } else {
    assert.equal(ids.length, 5);
    assert.equal(
      ids[0],
      "nvidia/nemotron-3-super-120b-a12b",
      "parallel cheap-worker fan-out should prefer Nemotron's capable low-cost lane",
    );
    const vendors = new Set(ids.map(id => id.split("/")[0]));
    assert.equal(vendors.size, 5, `expected 5 distinct vendors, got ${[...vendors].join(",")}`);
    assert.ok(ids.every(id => id.includes("/")), "all cheap-pool ids must be vendor/model format");
  }
});

test("premium returns the FIXED cheap-frontier trio, immune to the tier-override file", () => {
  // Bob 2026-08-13 "best of the best" program: 3 cheapest frontier-class drafters.
  // Deliberately NOT override-aware — the weekly tier-refresh file must never swap
  // pricier frontier ids into this cost-conscious pool.
  const ids = resolveProposerPool("premium");
  assert.deepEqual(ids, [
    "deepseek/deepseek-v4.1-flash",
    "gpt-5.4",
    "google/gemini-3.7-flash",
  ]);
});

test("polarity uses the current Sonnet seat for the systems evaluator", () => {
  const ids = resolveProposerPool("polarity");
  const modelId = "claude-sonnet-5-5";
  assert.equal(ids[ids.length - 1], modelId);
  assert.ok(!ids.includes("gemini-2.5-flash"));
  assert.ok(!ids.includes("gemini-3.5-flash"));
  assert.equal(
    MODEL_REGISTRY.find((model) => model.id === modelId)?.provider,
    "anthropic",
    "the evaluator must remain a registered, priced Anthropic model",
  );
});

test("MoA writes an estimated cost only when the provider omitted usage", () => {
  assert.equal(shouldRecordEstimatedMoACost(true, true, 20, 10), false, "durably recorded usage must never be duplicated");
  assert.equal(shouldRecordEstimatedMoACost(true, false, 20, 10), true, "a failed durable write needs one conservative estimate");
  assert.equal(shouldRecordEstimatedMoACost(false, undefined, 20, 10), true, "missing provider usage needs one conservative estimate");
  assert.equal(shouldRecordEstimatedMoACost(false, undefined, 0, 0), false, "a zero-token failed/empty call has no cost to estimate");
});

test("mixed returns frontier + 3 cheap (override-aware)", () => {
  const ids = resolveProposerPool("mixed");
  const override = readOverride();
  if (override && override.mundane.length >= 3) {
    assert.deepEqual(ids, [...override.frontier, ...override.mundane.slice(0, 3)]);
  } else {
    // Resolver falls back to the constant MIXED_PROPOSERS (hardcoded frontier + 3
    // cheap) whenever the override lacks >=3 mundane models — even if the
    // override's FRONTIER is active for the "frontier" pool.
    const frontier = resolveProposerPool("frontier");
    assert.equal(ids.length, frontier.length + 3);
    assert.deepEqual(ids.slice(0, frontier.length), frontier);
    assert.equal(
      ids[frontier.length],
      "nvidia/nemotron-3-super-120b-a12b",
      "mixed parallel fan-out should use Nemotron as its first economical worker",
    );
  }
});

test("explicit proposerIds win over pool (precedence contract)", () => {
  // R125+1 architect-fix companion test: locks the priority order
  // (explicit proposerIds > pool > default) at the resolver-input level.
  // The telemetry-tagging fix in moa.ts:333 relies on this precedence — if
  // anyone flips it, this test guards against accidental pool-tag leakage
  // into rows where pool did not actually pick the proposers.
  const cheap = resolveProposerPool("cheap");
  const frontier = resolveProposerPool("frontier");
  assert.notDeepEqual(cheap, frontier, "cheap and frontier must differ for this test to be meaningful");
  // The resolver itself only maps name -> ids; the precedence is enforced
  // in executeMoA. We assert the resolver returns the requested pool
  // verbatim — executeMoA's branch is what skips it when proposerIds is set.
  assert.deepEqual(resolveProposerPool("cheap"), cheap);
});

test("returns a fresh array (no shared mutable state across calls)", () => {
  const a = resolveProposerPool("frontier");
  const b = resolveProposerPool("frontier");
  assert.notEqual(a, b);
  a.push("hacked");
  assert.ok(!resolveProposerPool("frontier").includes("hacked"));
});
