import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skill = readFileSync(".agents/skills/delegation-contract/SKILL.md", "utf8");
const wiringAudit = readFileSync("scripts/verify-agent-wiring.ts", "utf8");
const pricing = readFileSync("client/src/pages/pricing.tsx", "utf8");
const seo = readFileSync("client/src/components/seo-head.tsx", "utf8");
const publicationNotice = readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
const releaseFacts = JSON.parse(readFileSync("docs/release-facts.json", "utf8"));
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

test("current sales and trust surfaces use authoritative skill totals and distinguish development from production", () => {
  for (const currentSurface of [pricing, landing]) {
    assert.doesNotMatch(currentSurface, /\b67 total skills\b/i);
  }
  assert.match(pricing, new RegExp(`\\b${releaseFacts.metrics.totalSkills} (?:total )?(?:platform )?skills\\b`, "i"));
  // Landing renders the authoritative JSON value instead of a duplicated literal.
  assert.match(landing, /import releaseFacts from ["']\.\.\/\.\.\/\.\.\/docs\/release-facts\.json["']/);
  assert.match(landing, /\{releaseFacts\.metrics\.totalSkills\} platform skills/);
  // SEO now consumes the shared release description, not obsolete R128 copy.
  assert.match(seo, /import \{ CURRENT_PLATFORM_DESCRIPTION \} from "@\/components\/prepublication-notice"/);
  assert.match(seo, /const effectiveDescription = useCurrentPlatformDescription\s+\? CURRENT_PLATFORM_DESCRIPTION/);
  assert.match(publicationNotice, /facts\.metrics\.totalSkills\} platform skills/);
  assert.match(publicationNotice, /Development evidence, not production telemetry/);
  assert.match(publicationNotice, /Production verification.*remain incomplete/);
  assert.equal(releaseFactsInput.platformAgentSkills, 5);
  assert.match(refreshTotals, /releaseInput\.platformAgentSkills/);
  assert.doesNotMatch(refreshTotals, /skills=.*\(\+4=/);
});