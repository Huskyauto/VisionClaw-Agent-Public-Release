import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("delivery verification bootstraps its required contracts on a fresh deployment", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/deliverable-verifier.ts"), "utf8");

  assert.match(source, /export async function ensureDefaultDeliverableContracts/);
  assert.match(source, /await ensureDefaultDeliverableContracts\(\);\s+const contract = await getContract/);
  assert.match(source, /ON CONFLICT \(deliverable_type\) DO NOTHING/);
  assert.doesNotMatch(source, /ON CONFLICT \(deliverable_type\) DO UPDATE/);
  assert.match(source, /type: "markdown_document"/);
});