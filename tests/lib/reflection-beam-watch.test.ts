import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runWatchlistAutoAdd, runRankingDrivenAutoAdd, type OpenRouterModel } from "../../server/model-catalog";

function beam(id = "reflection/beam", prompt = "0.000001", completion = "0.000002"): OpenRouterModel {
  return { id, name: "Reflection Beam", context_length: 262144,
    pricing: { prompt, completion }, architecture: { modality: "text->text" } };
}

describe("Reflection Beam catalog watch", () => {
  it("discovers Beam as a paid selectable OpenRouter model without writing during a dry run", () => {
    const result = runWatchlistAutoAdd([beam()], { persist: false });
    assert.equal(result.length, 1);
    assert.equal(result[0].provider, "openrouter");
    assert.equal(result[0].costClass, "paid");
    assert.deepEqual(result[0].capabilities, ["code", "tools"]);
    assert.match(result[0].description, /not.*default/i);
  });
  it("refuses incomplete pricing or context data and does not call a partially paid model free", () => {
    const malformed = [
      beam("reflection/beam", "", "0"),
      beam("reflection/beam", "NaN"),
      beam("reflection/beam", "-1"),
      beam("reflection/beam", "0", "1junk"),
      { ...beam(), context_length: 0 },
      { ...beam(), context_length: Infinity },
    ];
    assert.deepEqual(runWatchlistAutoAdd(malformed, { persist: false }), []);
    const paidInput = runWatchlistAutoAdd([beam("reflection/beam", "0.000001", "0")], { persist: false });
    assert.equal(paidInput[0].costClass, "cheap");
  });
  it("matches only official Beam-family IDs and permits a genuinely free listing", () => {
    const rejected = ["someone/beam", "reflection/llama-3", "reflection/beamish",
      "reflection-70b", "reflection/beam/other"];
    assert.deepEqual(runWatchlistAutoAdd(rejected.map(id => beam(id)), { persist: false }), []);
    for (const id of ["reflection/beam", "reflection-ai/beam-501b", "reflectionai/beam:free"]) {
      const result = runWatchlistAutoAdd([beam(id, "0", "0")], { persist: false });
      assert.equal(result.length, 1);
      assert.equal(result[0].costClass, "free");
    }
    assert.equal(runWatchlistAutoAdd([beam(), beam()], { persist: false }).length, 1);
  });
  it("defers request-fee listings and incompatible or unspecified modalities", () => {
    const invalid = [
      { ...beam(), pricing: { prompt: "0", completion: "0", request: "0.01" } },
      { ...beam(), pricing: { prompt: "0", completion: "0", request: "unknown" } },
      { ...beam(), architecture: { modality: "text->image" } },
      { ...beam(), architecture: { modality: "image->text" } },
      { ...beam(), architecture: undefined },
    ];
    assert.deepEqual(runWatchlistAutoAdd(invalid, { persist: false }), []);
    const noFee = { ...beam(), pricing: { ...beam().pricing, request: "0" } };
    assert.equal(runWatchlistAutoAdd([noFee], { persist: false }).length, 1);
  });
  it("does not let generic ranking adoption bypass Beam's admission contract", () => {
    const ranked = [{ name: "Beam", slug: "beam", creatorSlug: "reflection", index: 100, openness: "open" as const }];
    assert.deepEqual(runRankingDrivenAutoAdd(ranked, [beam()], { persist: false }).promoted, []);
  });
  it("persists and activates once, while dry runs leave both overlay and registry unchanged", () => {
    // Separate process + temporary cwd: never write synthetic model IDs into
    // the application's real overlay, even briefly.
    const root = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beam-watch-test-"));
    try {
      const script = path.join(tmp, "check.ts");
      fs.writeFileSync(script, `
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import { runWatchlistAutoAdd } from ${JSON.stringify(path.join(root, "server/model-catalog.ts"))};
        import { MODEL_REGISTRY } from ${JSON.stringify(path.join(root, "server/providers.ts"))};
        import { estimateCostUsd } from ${JSON.stringify(path.join(root, "server/agentic/cost-ledger.ts"))};
        const item = ${JSON.stringify(beam())};
        const before = MODEL_REGISTRY.length;
        assert.equal(runWatchlistAutoAdd([item], {persist:false}).length, 1);
        assert.equal(MODEL_REGISTRY.length, before);
        assert.equal(fs.existsSync("data/model-registry-overlay.json"), false);
        assert.equal(runWatchlistAutoAdd([item]).length, 1);
        assert.equal(MODEL_REGISTRY.filter(m=>m.id===item.id).length, 1);
        assert.equal(estimateCostUsd(item.id, 1000, 1000), 0.003, "paid Beam must not ledger as free");
        assert.equal(JSON.parse(fs.readFileSync("data/model-registry-overlay.json","utf8")).filter(m=>m.id===item.id).length, 1);
        assert.equal(runWatchlistAutoAdd([item]).length, 0);
        assert.equal(MODEL_REGISTRY.filter(m=>m.id===item.id).length, 1);
        console.log("BEAM_PERSISTENCE_OK");
      `);
      const output = execFileSync(process.execPath,
        [path.join(root, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", path.join(root, "tsconfig.json"), script],
        { cwd: tmp, encoding: "utf8", timeout: 20000 });
      assert.match(output, /BEAM_PERSISTENCE_OK/);
      const restartScript = path.join(tmp, "restart.ts");
      fs.writeFileSync(restartScript, `
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import { MODEL_REGISTRY, getCatalogModelPricing } from ${JSON.stringify(path.join(root, "server/model-registry.ts"))};
        import { estimateCostUsd } from ${JSON.stringify(path.join(root, "server/agentic/cost-ledger.ts"))};
        assert.equal(estimateCostUsd("reflection/beam", 1000, 1000), 0.003);
        assert.equal(estimateCostUsd("reflection/beam", 1000, 1000, 1000), 0.003, "unknown cache discounts must not undercount");
        const entry = MODEL_REGISTRY.find(m => m.id === "reflection/beam");
        assert.ok(entry);
        for (const input of [-1, Infinity, "0.000001", null]) {
          assert.equal(getCatalogModelPricing({...entry, catalogPricing: {inputUsdPerToken: input, outputUsdPerToken: 0.000002}}), undefined);
        }
        console.log("BEAM_RESTART_COST_OK");
      `);
      assert.match(execFileSync(process.execPath,
        [path.join(root, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", path.join(root, "tsconfig.json"), restartScript],
        { cwd: tmp, encoding: "utf8", timeout: 20000 }), /BEAM_RESTART_COST_OK/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
