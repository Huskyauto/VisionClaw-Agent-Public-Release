import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// Private script contracts are retained for source reviewers. Public runtime
// guards remain in module-map-mirror-safety and retained-tenant-audit-scope.
test("mirror build wiring: stage 3.7 generates from $DST after scrubs, before leak scan, rm -f on failure", () => {
  const file = "scripts/build-public-mirror.sh";
  assert.ok(existsSync(file), `${file} missing`);
  const sh = readFileSync(file, "utf8");
  const scrubIdx = sh.indexOf("[3/5] running sed scrubs");
  const stageIdx = sh.indexOf("[3.7/5] regenerating docs/MODULE_MAP.md");
  const verifyIdx = sh.indexOf("[4/5] verification");
  assert.ok(scrubIdx !== -1 && stageIdx !== -1 && verifyIdx !== -1, "expected stage markers missing");
  assert.ok(scrubIdx < stageIdx && stageIdx < verifyIdx,
    "stage 3.7 must run AFTER sed scrubs and BEFORE the [4/5] leak scan");
  const block = sh.slice(stageIdx, verifyIdx);
  assert.ok(/refresh-module-map\.ts --root "\$DST"/.test(block),
    "stage 3.7 must generate with --root \"$DST\" (the sanitized mirror tree)");
  const rmCount = (block.match(/rm -f "\$DST\/docs\/MODULE_MAP\.md"/g) || []).length;
  assert.ok(rmCount >= 2,
    `both failure branches (generator fail + npx missing) must rm -f the map; found ${rmCount}`);
  const invocations = block.split("\n").filter((l) => /tsx\s+\S*refresh-module-map\.ts/.test(l));
  assert.ok(invocations.length >= 1, "expected at least one generator invocation in stage 3.7");
  for (const inv of invocations) {
    assert.ok(inv.includes('--root "$DST"'),
      `root-less (private-tree) invocation not allowed: ${inv.trim()}`);
  }
});

test("snapshot exporter selects stable IDs for all three source collections", () => {
  const source = readFileSync("scripts/sync-dev-to-prod.ts", "utf8");
  for (const table of ["research_programs", "research_sessions", "research_experiments"]) {
    assert.match(source, new RegExp(`SELECT id,[^\\x60]+FROM ${table}`));
  }
});
