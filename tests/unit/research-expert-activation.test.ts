import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("expert research activation is bounded, scheduled, and documented", () => {
  const seed = fs.readFileSync("server/seed-infrastructure.ts", "utf8");
  const policy = fs.readFileSync("server/research-expert-mode.ts", "utf8");
  const env = fs.readFileSync(".env.example", "utf8");
  const configSkill = fs.readFileSync(".agents/skills/visionclaw-config-and-flags/SKILL.md", "utf8");

  assert.match(policy, /Expert Evidence: Model Routing & Cost/);
  assert.match(seed, /max_experiments_per_session[\s\S]{0,500}\b2\b/);
  assert.match(seed, /15 3 \* \* 1/);
  assert.match(seed, /tenant_id = 1/);
  assert.match(env, /^RESEARCH_EXPERT_MODE=0$/m);
  assert.match(configSkill, /RESEARCH_EXPERT_MODE/);
});

test("research engine keeps expert mode behind exact activation and durable verification", () => {
  const engine = fs.readFileSync("server/research-engine.ts", "utf8");
  assert.match(engine, /session\.evalType === "cost" && isExpertResearchEnabled\(\)/);
  assert.match(engine, /estimatedUsd: expertCostMode \? 2\.00 : 0\.10/);
  assert.match(engine, /expertCostMode \? "failed" : "unverified"/);
  assert.match(engine, /if \(expertCostMode\) score = Math\.min\(score, 4\)/);
  assert.match(engine, /verification_status = \$\{verificationStatus\}/);
  assert.match(engine, /verification_details = \$\{verificationDetails\}/);
});