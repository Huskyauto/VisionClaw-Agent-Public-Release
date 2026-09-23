import assert from "node:assert/strict";
import test from "node:test";
import { resolveProjectCommand } from "../../server/lib/project-command";

test("accepts the declared project command field", () => {
  assert.deepEqual(resolveProjectCommand({ command: "list" }), { ok: true, command: "list" });
});

test("accepts legacy operation and action aliases instead of producing undefined", () => {
  assert.deepEqual(resolveProjectCommand({ operation: "create" }), { ok: true, command: "create" });
  assert.deepEqual(resolveProjectCommand({ action: "search" }), { ok: true, command: "search" });
});

test("returns a structured error for missing and unknown commands", () => {
  const missing = resolveProjectCommand({});
  assert.equal(missing.ok, false);
  assert.match(missing.error || "", /required/i);
  assert.ok(missing.allowedCommands?.includes("create"));

  const unknown = resolveProjectCommand({ command: "invent" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error || "", /unknown/i);
  assert.ok(!String(unknown.error).includes("undefined"));
});