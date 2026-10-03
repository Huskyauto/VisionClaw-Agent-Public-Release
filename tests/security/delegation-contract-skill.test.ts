import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skill = readFileSync(".agents/skills/delegation-contract/SKILL.md", "utf8");
const wiringAudit = readFileSync("scripts/verify-agent-wiring.ts", "utf8");
const pricing = readFileSync("client/src/pages/pricing.tsx", "utf8");
const seo = readFileSync("client/src/components/seo-head.tsx", "utf8");
const landing = readFileSync("client/src/pages/landing.tsx", "utf8");
const releaseFactsInput = JSON.parse(readFileSync("docs/release-facts-input.json", "utf8"));
const refreshTotals = readFileSync("scripts/refresh-totals.ts", "utf8");

test("substantial subagents receive a complete model-agnostic delegation contract", () => {
  assert.match(skill, /every substantial subagent[\s\S]*goal and acceptance criteria/i);
  assert.match(skill, /read\/write scope and ownership[\s\S]*exact files[\s\S]*explicit exclusions/i);
  assert.match(skill, /authority boundaries[\s\S]*delegated authority never exceeds the parent agent's authority/i);
  assert.match(skill, /known facts[\s\S]*does not repeat discovery/i);
  assert.match(skill, /required verification[\s\S]*completion claim is not verification/i);
  assert.match(skill, /evidence-dense output[\s\S]*file references[\s\S]*uncertainty[\s\S]*blockers/i);
  assert.match(skill, /context and output budget[\s\S]*never truncate away failures or uncertainty/i);
  assert.match(skill, /stop conditions[\s\S]*scope must expand[\s\S]*authority is insufficient/i);
  assert.match(skill, /do not hardcode model names[\s\S]*complexity[\s\S]*risk[\s\S]*cost/i);
});

test("delegation concurrency and review depth scale with risk", () => {
  assert.match(skill, /read-only work may run in parallel[\s\S]*questions are independent/i);
  assert.match(skill, /writers may run in parallel only with explicitly disjoint file ownership[\s\S]*no shared generated files/i);
  assert.match(skill, /never assign multiple subagents to edit the same file at the same time/i);
  assert.match(skill, /high-risk[\s\S]*require an independent reviewer and every applicable domain safety gate/i);
  assert.match(skill, /low-risk[\s\S]*parent verification without an automatic premium review/i);
  assert.match(skill, /handoff must record provenance[\s\S]*scope[\s\S]*completion status[\s\S]*creation time/i);
  assert.match(skill, /stale claims must be revalidated before use/i);
});

test("the tracked contract is declared as a main-agent-only operational skill", () => {
  assert.match(wiringAudit, /MAIN_AGENT_ONLY_SKILLS[\s\S]*"delegation-contract"/);
});

test("current R128 sales and trust surfaces use the current skill total and describe guidance honestly", () => {
  for (const currentSurface of [pricing, seo, landing]) {
    assert.doesNotMatch(currentSurface, /\b67 total skills\b/i);
    assert.match(currentSurface, /\b68 (?:total )?(?:platform )?skills\b/i);
  }
  assert.match(seo, /main-agent guidance requires/i);
  assert.match(landing, /guidance with regression gates, not runtime interception/i);
  assert.equal(releaseFactsInput.platformAgentSkills, 5);
  assert.match(refreshTotals, /releaseInput\.platformAgentSkills/);
  assert.doesNotMatch(refreshTotals, /skills=.*\(\+4=/);
});