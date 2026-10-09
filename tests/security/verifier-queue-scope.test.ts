import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";

test("actual queue claim and both reclamation updates preserve compiler scope", () => {
  const output = execFileSync(process.execPath, [
    "--import", "tsx", path.resolve("tests/fixtures/verifier-queue-scope.ts"),
  ], { timeout: 20_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /VERIFIER_QUEUE_SCOPE_PASS/);
});