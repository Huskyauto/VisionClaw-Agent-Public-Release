import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("current sales and trust surfaces use authoritative skill totals and distinguish development from production", () => {
  const pricing = readFileSync("client/src/pages/pricing.tsx", "utf8");
  const landing = readFileSync("client/src/pages/landing.tsx", "utf8");
  const seo = readFileSync("client/src/components/seo-head.tsx", "utf8");
  const publicationNotice = readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
  const releaseFacts = JSON.parse(readFileSync("docs/release-facts.json", "utf8"));
  const releaseFactsInput = JSON.parse(readFileSync("docs/release-facts-input.json", "utf8"));
  const refreshTotals = readFileSync("scripts/refresh-totals.ts", "utf8");
  for (const currentSurface of [pricing, landing]) {
    assert.doesNotMatch(currentSurface, /\b67 total skills\b/i);
  }
  assert.match(pricing, new RegExp(`\\b${releaseFacts.metrics.totalSkills} (?:total )?(?:platform )?skills\\b`, "i"));
  assert.match(landing, /import releaseFacts from ["']\.\.\/\.\.\/\.\.\/docs\/release-facts\.json["']/);
  assert.match(landing, /\{releaseFacts\.metrics\.totalSkills\} platform skills/);
  assert.match(seo, /import \{ CURRENT_PLATFORM_DESCRIPTION \} from "@\/components\/prepublication-notice"/);
  assert.match(seo, /const effectiveDescription = useCurrentPlatformDescription\s+\? CURRENT_PLATFORM_DESCRIPTION/);
  assert.match(publicationNotice, /facts\.metrics\.totalSkills\} platform skills/);
  assert.match(publicationNotice, /Development evidence, not production telemetry/);
  assert.match(publicationNotice, /Production verification.*remain incomplete/);
  assert.equal(releaseFactsInput.platformAgentSkills, 5);
  assert.match(refreshTotals, /releaseInput\.platformAgentSkills/);
  assert.doesNotMatch(refreshTotals, /skills=.*\(\+4=/);
});
