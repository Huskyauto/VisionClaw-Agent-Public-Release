import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";

test("expired customer Gmail stays customer-owned through status, scheduled send and uncertain persistence", () => {
  const output = execFileSync(process.execPath, [
    "--import", "tsx", path.resolve("tests/fixtures/scheduled-gmail-owned-grant.ts"),
  ], { cwd: process.cwd(), timeout: 20_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /OWNED_GRANT_AND_SCHEDULE_PASS/);
});