import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isReservedKnowledgeCategory,
  RESERVED_KNOWLEDGE_CATEGORIES,
} from "../../server/lib/reserved-knowledge-categories";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// The reserved-category guard defends against the cross-tenant SMS/WhatsApp
// pairing hijack: `messaging_pairing` agent_knowledge rows map an inbound
// phone/channel to a tenant+conversation (server/twilio.ts). No generic or
// agentic knowledge writer may plant one (post-edit-code-review HIGH,
// 2026-07-09). These tests are query-free (no DB pool) by design.

test("messaging_pairing is a reserved category", () => {
  assert.ok(RESERVED_KNOWLEDGE_CATEGORIES.has("messaging_pairing"));
});

test("isReservedKnowledgeCategory matches case/whitespace variants", () => {
  for (const v of ["messaging_pairing", "MESSAGING_PAIRING", "  Messaging_Pairing  "]) {
    assert.equal(isReservedKnowledgeCategory(v), true, `variant ${JSON.stringify(v)} must be reserved`);
  }
});

test("isReservedKnowledgeCategory does not over-match benign categories", () => {
  for (const v of ["reference", "insight", "research_digest", "preference", "", "pairing"]) {
    assert.equal(isReservedKnowledgeCategory(v), false, `${JSON.stringify(v)} must be allowed`);
  }
});

test("isReservedKnowledgeCategory fails safe on non-string input", () => {
  for (const v of [null, undefined, 42, {}, []]) {
    assert.equal(isReservedKnowledgeCategory(v as any), false);
  }
});

test("storage.createKnowledge enforces the reserved-category backstop for ALL writers", () => {
  const src = read("server/storage.ts");
  assert.match(src, /RESERVED_KNOWLEDGE_CATEGORIES/, "storage must reference the reserved-category set");
  assert.match(src, /allowReservedCategory/, "storage must expose an explicit opt-in override");
  // The guard must THROW (fail closed), not silently write, when a reserved
  // category is passed without the override.
  const start = src.indexOf("async createKnowledge(");
  const block = src.slice(start, start + 1600);
  assert.match(block, /allowReservedCategory/, "guard must be inside createKnowledge");
  assert.match(block, /RESERVED_KNOWLEDGE_CATEGORIES\.has/, "guard must test membership");
  assert.match(block, /throw new Error/, "guard must fail closed (throw)");
});

test("storage.updateKnowledge blocks transitions INTO a reserved category", () => {
  const src = read("server/storage.ts");
  const start = src.indexOf("async updateKnowledge(");
  const block = src.slice(start, start + 1400);
  assert.match(block, /allowReservedCategory/, "update path must expose the opt-in override");
  assert.match(block, /RESERVED_KNOWLEDGE_CATEGORIES\.has/, "update path must test membership");
  assert.match(block, /throw new Error/, "update path must fail closed (throw)");
});

test("create_knowledge tool front-stops the reserved category", () => {
  const src = read("server/tools/domains/knowledge/handlers.ts");
  assert.match(src, /isReservedKnowledgeCategory/, "tool handler must front-stop reserved categories");
});

test("heartbeat knowledge-task insertion routes through storage.createKnowledge (covered by the backstop)", () => {
  const src = read("server/heartbeat.ts");
  assert.match(src, /storage\.createKnowledge\(/, "heartbeat must write via storage.createKnowledge so the backstop applies");
});
