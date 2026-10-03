import { test } from "node:test";
import assert from "node:assert/strict";
import { readCgroupMemoryMetrics } from "../../server/lib/cgroup-memory-metrics";

test("cgroup memory exposes finite usage, limit and OOM counters", () => {
  const files: Record<string, string> = {
    "/sys/fs/cgroup/memory.current": "1048576\n",
    "/sys/fs/cgroup/memory.max": "4294967296\n",
    "/sys/fs/cgroup/memory.events": "low 0\nhigh 2\nmax 1\noom 3\noom_kill 1\n",
  };
  const result = readCgroupMemoryMetrics((name) => {
    if (!(name in files)) throw new Error("missing");
    return files[name];
  });
  assert.deepEqual(result, {
    currentBytes: 1048576,
    maxBytes: 4294967296,
    events: { high: 2, oom: 3, oomKill: 1 },
  });
});

test("unlimited cgroup omits its limit and missing events never look like zero OOMs", () => {
  const result = readCgroupMemoryMetrics((name) => {
    if (name.endsWith("memory.current")) return "1048576\n";
    if (name.endsWith("memory.max")) return "max\n";
    throw Object.assign(new Error("not supported"), { code: "ENOENT" });
  });
  assert.deepEqual(result, { currentBytes: 1048576, maxBytes: null, events: null });
});

test("missing or malformed cgroup usage is unavailable, not a zero measurement", () => {
  assert.equal(readCgroupMemoryMetrics(() => { throw new Error("not mounted"); }), null);
  assert.equal(readCgroupMemoryMetrics((name) => name.endsWith("memory.current") ? "not-a-number" : "4294967296"), null);
  assert.equal(readCgroupMemoryMetrics((name) => name.endsWith("memory.current") ? "-1" : "4294967296"), null);
});