import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { compactQueue } from "../../server/service-review-queue";
import { confinedRegularFilePath } from "../../server/lib/confined-file-cleanup";

test("queue compaction preserves every unresolved order and newest terminal history", () => {
  const items = [
    { id: "old-pending", status: "pending", createdAt: "2020-01-01" },
    ...Array.from({ length: 510 }, (_, i) => ({ id: `terminal-${i}`, status: "shipped", createdAt: `2021-${String(i + 1).padStart(3, "0")}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `retry-${i}`, status: "failed", createdAt: `2023-01-0${i + 1}` })),
  ];
  const compacted = compactQueue(items);
  assert.ok(compacted.some(item => item.id === "old-pending"));
  assert.ok(compacted.some(item => item.id === "retry-2"));
  assert.ok(!compacted.some(item => item.id === "terminal-0"));
  assert.equal(compacted.length, 500);
});

test("unsafe previous artifact path is never eligible for local deletion", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
  const outside = path.join(root, "..", "outside.pdf");
  fs.writeFileSync(outside, "sentinel");
  try {
    assert.equal(confinedRegularFilePath(outside, root), null);
    assert.equal(fs.existsSync(outside), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { force: true }); }
});