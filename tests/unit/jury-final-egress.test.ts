import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("retention must not restore unscanned jury prose after final egress", () => {
  const source = readFileSync("server/chat-engine.ts", "utf8");
  const boundary = source.indexOf("cleanedResponse = egress.content;");
  const persistence = source.indexOf("const assistantMsgRow = await storage.createMessage", boundary);
  assert.ok(boundary > 0 && persistence > boundary);
  assert.doesNotMatch(source.slice(boundary, persistence),
    /cleanedResponse\s*=\s*retainedJuryPackage/);
});
