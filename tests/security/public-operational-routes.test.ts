import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("legacy anonymous deliverable and operational telemetry routes are not exposed", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");

  assert.match(source, /app\.get\("\/api\/public\/deliverable\/:project\/:file", \(_req, res\) =>/);
  assert.match(source, /Legacy public deliverable links are disabled/);
  assert.match(source, /app\.get\("\/api\/public\/stats", authMiddleware, async \(req, res\) =>/);
  assert.match(source, /app\.get\("\/api\/public\/architecture", authMiddleware, async \(req, res\) =>/);
});