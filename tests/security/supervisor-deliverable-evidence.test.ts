import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("supervisor rejects a deliverable claim when no tool returned artifact evidence", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/execution-supervisor.ts"), "utf8");

  assert.match(source, /if \(claimed\.length && !file\)/);
  assert.match(source, /no concrete file path or URL was returned by any tool/);
  assert.match(source, /DELIVERABLE_VERIFICATION_UNVERIFIED/);
});