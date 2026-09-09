import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("dream consolidation scopes session message reads to the requested tenant", () => {
  const source = read("server/dream-consolidation.ts");

  assert.match(
    source,
    /SELECT role, content FROM messages\s+WHERE conversation_id = \$\{conv\.id\} AND tenant_id = \$\{tenantId\}/,
    "message content reads must bind both the selected conversation and its tenant",
  );
});

test("project-context fallback history queries bind the requesting tenant", () => {
  const source = read("server/chat-engine/project-context.ts");

  assert.match(source, /FROM compaction_archives\s+WHERE conversation_id = \$\{c\.id\} AND tenant_id = \$\{tenantId\}/);
  assert.match(source, /FROM messages\s+WHERE conversation_id = \$\{c\.id\} AND tenant_id = \$\{tenantId\}/);
});

test("evaluator conversation joins bind the same tenant as messages", () => {
  const source = read("server/evaluators.ts");

  assert.match(source, /FROM messages m JOIN conversations c ON m\.conversation_id = c\.id AND c\.tenant_id = \$\{tenantId\}/);
});

test("Minerva validates a revision parent belongs to the same tenant before inserting", () => {
  const source = read("server/minerva-planner.ts");

  assert.match(
    source,
    /SELECT id FROM plans\s+WHERE id = \$\{args\.parentPlanId\} AND tenant_id = \$\{tenantId\}/,
    "a caller must not be able to link a new plan to another tenant's parent plan",
  );
});