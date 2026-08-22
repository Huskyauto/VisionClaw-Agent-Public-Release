/**
 * Skill Pool Similarity Watchdog tests — R125+155.
 *
 * Deterministic fake embedder; pins: confusable-pair flagging, per-item
 * fail-open skips, danger-zone reporting, and the maxSkills cap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSkillPool } from "../../server/lib/skill-pool-similarity";

function embedderFor(map: Record<string, number[]>) {
  return async (text: string) => {
    for (const k of Object.keys(map)) if (text.includes(k)) return map[k];
    return null;
  };
}

test("flags near-duplicate pairs and reports warn-band pairs", async () => {
  const embed = embedderFor({
    dupA: [1, 0, 0],
    dupB: [0.99, 0.01, 0], // ~0.999 vs dupA → flagged
    warnC: [0.8, 0.6, 0],  // ~0.8 vs dupA → warn band only
    farD: [0, 0, 1],
  });
  const r = await analyzeSkillPool({
    skills: [
      { name: "A", text: "dupA", source: "db" },
      { name: "B", text: "dupB", source: "agents-dir" },
      { name: "C", text: "warnC" },
      { name: "D", text: "farD" },
    ],
    embed,
  });
  assert.equal(r.embedded, 4);
  assert.equal(r.flaggedPairs.length, 1);
  assert.deepEqual([r.flaggedPairs[0].a, r.flaggedPairs[0].b], ["A", "B"]);
  assert.ok(r.confusablePairs.length >= 2); // A-B flagged + A-C warn
  assert.ok(r.confusablePairs[0].similarity >= r.confusablePairs[1].similarity, "sorted desc");
});

test("per-item fail-open: unembeddable skills are skipped, not fatal", async () => {
  const embed = embedderFor({ ok1: [1, 0], ok2: [0, 1] });
  const r = await analyzeSkillPool({
    skills: [
      { name: "good1", text: "ok1" },
      { name: "broken", text: "nomatch" },
      { name: "good2", text: "ok2" },
    ],
    embed,
  });
  assert.equal(r.embedded, 2);
  assert.deepEqual(r.skipped, ["broken"]);
  assert.equal(r.flaggedPairs.length, 0);
});

test("danger zone reflects pool size vs threshold", async () => {
  const embed = async () => [1, 0];
  const skills = Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, text: `t${i}` }));
  const small = await analyzeSkillPool({ skills, embed, dangerZoneSize: 40, warnThreshold: 1.01 });
  assert.equal(small.inDangerZone, false);
  const big = await analyzeSkillPool({ skills, embed, dangerZoneSize: 5, warnThreshold: 1.01 });
  assert.equal(big.inDangerZone, true);
  assert.ok(big.summary.includes("danger zone"));
});

test("maxSkills cap bounds the comparison and reports overflow as skipped", async () => {
  const embed = async () => [1, 0];
  const skills = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, text: `t${i}` }));
  const r = await analyzeSkillPool({ skills, embed, maxSkills: 4, warnThreshold: 1.01 });
  assert.equal(r.embedded, 4);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.poolSize, 6);
});

test("throwing embedder is contained per item", async () => {
  const r = await analyzeSkillPool({
    skills: [{ name: "a", text: "x" }, { name: "b", text: "y" }],
    embed: async () => { throw new Error("boom"); },
  });
  assert.equal(r.embedded, 0);
  assert.equal(r.skipped.length, 2);
});
