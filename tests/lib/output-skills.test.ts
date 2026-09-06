import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  loadRegistry,
  listOutputSkills,
  lookupOutputSkill,
} from "../../server/lib/output-skills";

const SKILLS_DIR = join(process.cwd(), "data/output-skills");

test("registry loads and lists a healthy library of skills", () => {
  const reg = loadRegistry();
  // Floor, not an exact count: the library grows as new deliverable templates
  // are added (this used to hard-pin 25 and went stale every time a skill landed).
  // A floor still catches mass-deletion while the no-orphans + sha256-drift tests
  // below catch additions/edits, so the tripwire stays intact without churn.
  assert.ok(reg.skills.length >= 35, `expected >= 35 output skills, got ${reg.skills.length}`);
  assert.equal(reg.source_license, "MIT");
  assert.ok(reg.source_repo.startsWith("https://github.com/"));
});

test("every registry entry has a matching .md file on disk", () => {
  const reg = loadRegistry();
  for (const s of reg.skills) {
    const p = join(SKILLS_DIR, s.file);
    assert.ok(existsSync(p), `missing file for topic ${s.topic}: ${s.file}`);
    const content = readFileSync(p, "utf-8");
    assert.ok(content.length > 200, `${s.topic} content unreasonably small`);
  }
});

test("every .md file on disk is in the registry (no orphans)", () => {
  const reg = loadRegistry();
  const registered = new Set(reg.skills.map((s) => s.file));
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md") && f !== "NOTICE.md");
  for (const f of files) {
    assert.ok(registered.has(f), `orphan output-skill file: ${f}`);
  }
});

test("departments cover lean-business surface", () => {
  const reg = loadRegistry();
  const depts = new Set(reg.skills.map((s) => s.department));
  // Must hit each major department a lean operator needs.
  for (const expected of [
    "Product",
    "Strategy",
    "Communications",
    "Sales",
    "Marketing",
    "Legal",
    "HR",
    "Operations",
  ]) {
    assert.ok(depts.has(expected), `missing department: ${expected}`);
  }
});

test("lookupOutputSkill returns content for a known topic", () => {
  const r = lookupOutputSkill("prd-template");
  assert.equal(r.ok, true);
  assert.equal(r.topic, "prd-template");
  assert.ok(r.content && r.content.length > 200);
  assert.ok(r.content!.toLowerCase().includes("requirements"));
});

test("lookupOutputSkill rejects path traversal", () => {
  const cases = [
    "../etc/passwd",
    "..",
    "prd/../../../etc",
    "/etc/passwd",
    "foo/bar",
  ];
  for (const bad of cases) {
    const r = lookupOutputSkill(bad);
    assert.equal(r.ok, false, `expected failure for ${JSON.stringify(bad)}`);
  }
});

test("lookupOutputSkill rejects NUL byte and non-string input", () => {
  const r1 = lookupOutputSkill("prd-template\u0000extra");
  assert.equal(r1.ok, false);
  const r2 = lookupOutputSkill("" as unknown as string);
  assert.equal(r2.ok, false);
  const r3 = lookupOutputSkill(null as unknown as string);
  assert.equal(r3.ok, false);
});

test("lookupOutputSkill is case-insensitive and trims", () => {
  const r = lookupOutputSkill("  PRD-TEMPLATE  ");
  assert.equal(r.ok, true);
});

test("listOutputSkills filters by department", () => {
  const legal = listOutputSkills({ department: "Legal" });
  assert.ok(legal.length >= 3);
  for (const s of legal) assert.equal(s.department, "Legal");
});

test("listOutputSkills filters by persona", () => {
  const minerva = listOutputSkills({ persona: "minerva" });
  assert.ok(minerva.length >= 3);
  for (const s of minerva) {
    assert.ok(s.persona_fit.includes("minerva"), `${s.topic} did not fit minerva`);
  }
});

test("every registry entry's SHA-256 matches the file on disk (drift guard)", () => {
  const reg = loadRegistry();
  for (const s of reg.skills as Array<{ topic: string; file: string; sha256?: string; bytes?: number }>) {
    assert.ok(s.sha256, `${s.topic}: registry must pin sha256`);
    assert.equal(typeof s.bytes, "number", `${s.topic}: registry must pin bytes`);
    const buf = readFileSync(join(SKILLS_DIR, s.file));
    assert.equal(buf.length, s.bytes, `${s.topic}: byte length drift`);
    const actual = createHash("sha256").update(buf).digest("hex");
    assert.equal(actual, s.sha256, `${s.topic}: SHA-256 drift — file edited without registry update`);
  }
});

test("dispatcher: lookup_output_skill returns content for topic mode", async () => {
  const { executeTool } = await import("../../server/tools");
  const res: any = await executeTool("lookup_output_skill", { topic: "investor-update" });
  assert.equal(res.ok, true);
  assert.equal(res.topic, "investor-update");
  assert.equal(res.department, "Communications");
  assert.ok(typeof res.content === "string" && res.content.length > 200);
});

test("dispatcher: lookup_output_skill list mode by department", async () => {
  const { executeTool } = await import("../../server/tools");
  const res: any = await executeTool("lookup_output_skill", { department: "Legal" });
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.topics));
  assert.ok(res.topics.length >= 3);
  for (const t of res.topics) assert.equal(t.department, "Legal");
});

test("dispatcher: lookup_output_skill rejects path traversal at the tool boundary", async () => {
  const { executeTool } = await import("../../server/tools");
  const res: any = await executeTool("lookup_output_skill", { topic: "../etc/passwd" });
  assert.equal(res.ok, false);
});

test("dispatcher: lookup_output_skill rejects mixed-mode args (topic + department)", async () => {
  const { executeTool } = await import("../../server/tools");
  const res: any = await executeTool("lookup_output_skill", { topic: "investor-update", department: "Legal" });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /EITHER|both/i);
});

test("dispatcher: lookup_output_skill rejects empty args", async () => {
  const { executeTool } = await import("../../server/tools");
  const res: any = await executeTool("lookup_output_skill", {});
  assert.equal(res.ok, false);
  assert.match(String(res.error), /topic|department|persona/i);
});

test("lookup_output_skill tool is registered with safe LOW policy", async () => {
  const src = readFileSync(join(process.cwd(), "server/safety/destructive-tool-policy.ts"), "utf-8");
  assert.match(src, /lookup_output_skill[\s\S]{0,200}risk: "safe"/);
  assert.match(src, /lookup_output_skill[\s\S]{0,200}riskClass: "LOW"/);
});
