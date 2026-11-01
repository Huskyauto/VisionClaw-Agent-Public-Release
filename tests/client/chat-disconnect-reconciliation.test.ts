import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("client/src/pages/chat.tsx", "utf8");

test("uncertain chat completion reconciles saved reads rather than encouraging blind resend", () => {
  assert.doesNotMatch(source, /Consider resending|Try resending|try stopping and resending|Response recovered —/);
  const start = source.indexOf("if (hadError) {\n        // Read-only reconciliation");
  assert.ok(start > 0);
  const block = source.slice(start, source.indexOf("if (!hadError)", start));
  assert.match(block, /queryKey: \["\/api\/conversations", conversationId\]/);
  assert.doesNotMatch(block, /authFetch|method:\s*["']POST|sendMessage/);
});
