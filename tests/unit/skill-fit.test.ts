/**
 * Skill Fit Tiering tests — R125+155.
 *
 * Deterministic fake embedder (no network, no DB — lib tests stay query-free).
 * Pins: tier thresholds, fail-open on embedder failure/timeout, embedding
 * cache reuse, and the untiered-null contract.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  scoreSkillFit,
  tierFromSimilarity,
  skillFitText,
  _clearSkillFitCache,
  SKILL_FIT_PROMPT_RULE,
} from "../../server/lib/skill-fit";

beforeEach(() => _clearSkillFitCache());

// Fake embedder: maps known strings to fixed vectors.
function makeEmbedder(map: Record<string, number[]>, fallback: number[] | null = [0, 1]) {
  const calls: string[] = [];
  const embed = async (text: string) => {
    calls.push(text);
    for (const k of Object.keys(map)) if (text.includes(k)) return map[k];
    return fallback;
  };
  return { embed, calls };
}

test("tierFromSimilarity maps thresholds and junk deterministically", () => {
  assert.equal(tierFromSimilarity(0.9), "High");
  assert.equal(tierFromSimilarity(0.45), "High");
  assert.equal(tierFromSimilarity(0.449), "Medium");
  assert.equal(tierFromSimilarity(0.25), "Medium");
  assert.equal(tierFromSimilarity(0.1), "Low");
  assert.equal(tierFromSimilarity(NaN), "Low");
});

test("scores skills into tiers against the user message", async () => {
  const { embed } = makeEmbedder({
    "deploy the app": [1, 0],
    "deployment:": [0.95, 0.05], // high similarity with message
    "cooking:": [0, 1],          // orthogonal
  });
  const fit = await scoreSkillFit({
    userMessage: "please deploy the app",
    skills: [
      { name: "deployment", description: "publish and deploy the project" },
      { name: "cooking", description: "recipes and meal planning" },
    ],
    embed,
  });
  assert.ok(fit);
  assert.equal(fit!.get("deployment")!.tier, "High");
  assert.equal(fit!.get("cooking")!.tier, "Low");
});

test("fail-open: throwing embedder returns null, never throws", async () => {
  const fit = await scoreSkillFit({
    userMessage: "hello",
    skills: [{ name: "a", description: "b" }],
    embed: async () => { throw new Error("boom"); },
  });
  assert.equal(fit, null);
});

test("fail-open: PARTIAL embedding failure fails the whole pass to null", async () => {
  // Message + first skill embed fine; second skill fails → entire pass null,
  // never a half-tagged map (architect finding).
  const fit = await scoreSkillFit({
    userMessage: "deploy the app",
    skills: [
      { name: "good", description: "works fine" },
      { name: "broken", description: "EMBED_FAIL" },
    ],
    embed: async (text: string) => (text.includes("EMBED_FAIL") ? null : [1, 0]),
  });
  assert.equal(fit, null);
});

test("fail-open: deadline expiry returns null (advisory, untiered)", async () => {
  const fit = await scoreSkillFit({
    userMessage: "hello",
    skills: [{ name: "a", description: "b" }],
    embed: () => new Promise((resolve) => setTimeout(() => resolve([1, 0]), 200)),
    timeoutMs: 20,
  });
  assert.equal(fit, null);
});

test("skill embeddings are cached across calls (one message embed per turn)", async () => {
  const { embed, calls } = makeEmbedder({}, [1, 0]);
  const skills = [{ name: "s1", description: "alpha" }, { name: "s2", description: "beta" }];
  await scoreSkillFit({ userMessage: "first turn", skills, embed });
  const afterFirst = calls.length; // 1 message + 2 skills
  assert.equal(afterFirst, 3);
  await scoreSkillFit({ userMessage: "second turn", skills, embed });
  // Second turn: only the message is embedded; skill vectors come from cache.
  assert.equal(calls.length, afterFirst + 1);
});

test("skillFitText prefers description, falls back to prompt prefix", () => {
  assert.equal(skillFitText({ name: "x", description: "d" }), "x: d");
  assert.ok(skillFitText({ name: "x", promptContent: "p".repeat(500) }).length <= 405);
});

test("prompt rule mentions all three tiers", () => {
  for (const t of ["High", "Medium", "Low"]) assert.ok(SKILL_FIT_PROMPT_RULE.includes(t));
});
