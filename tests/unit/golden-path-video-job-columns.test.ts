import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { videoJobs } from "../../shared/schema";

test("golden-path replay polls only columns declared on video_jobs", () => {
  const source = fs.readFileSync(path.resolve("scripts/golden-path-replay.ts"), "utf8");
  const query = /SELECT\s+([\w,\s]+?)\s+FROM\s+video_jobs\s+WHERE\s+job_id/gi;
  const selected = [...source.matchAll(query)];
  assert.equal(selected.length, 1, "expected exactly one video-job polling query");

  const columns = new Set(Object.values(getTableColumns(videoJobs)).map((column) => column.name));
  const selectedNames = selected[0][1].split(",").map((column) => column.trim());
  for (const name of selectedNames) {
    assert.ok(columns.has(name), `video_jobs has no column named ${name}`);
  }

  const completedPath = /if \(row\?\.status === "done"\)\s*\{\s*raw = row\.(\w+)/.exec(source);
  assert.ok(completedPath, "expected completed video jobs to resolve an artifact path");
  assert.ok(selectedNames.includes(completedPath[1]), `completed-job path ${completedPath[1]} was not selected`);
});