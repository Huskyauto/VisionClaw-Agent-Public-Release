import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("skill seeker sends capability mutations through the guarded approval boundary", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/skill-seeker.ts"), "utf8");

  assert.match(source, /executeGuardedTool\("create_tool"/);
  assert.match(source, /executeGuardedTool\("manage_skills"/);
  assert.match(source, /capability mutation requires explicit owner approval/);
  assert.doesNotMatch(source, /executeTool\("create_tool"/);
  assert.doesNotMatch(source, /executeTool\("manage_skills"/);
});