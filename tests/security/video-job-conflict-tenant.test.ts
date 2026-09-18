import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("video job upsert cannot update a colliding job id owned by another tenant", () => {
  const source = readFileSync(resolve(root, "server/video-job-runner.ts"), "utf8");
  const upsert = source.slice(
    source.indexOf("onConflictDoUpdate({"),
    source.indexOf("// R111 — Read cancel flag"),
  );

  assert.match(upsert, /target:\s*videoJobs\.jobId/);
  assert.match(
    upsert,
    /where:\s*and\(\s*eq\(videoJobs\.tenantId,\s*row\.tenantId\),\s*lt\(videoJobs\.updatedAt,\s*row\.updatedAt\),?\s*\)/s,
    "DO UPDATE must reject a globally unique job-id collision when tenant ownership differs",
  );
});