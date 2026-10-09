import assert from "node:assert/strict";
import test from "node:test";
import {
  readEffectiveCgroupV2Memory,
  readEffectiveVerifierMemory,
  readVerifierMemoryDiagnostic,
  summarizeUnavailableVerifierMemory,
} from "../../server/lib/verifier-memory-source";

const GiB = 1024 ** 3;

test("uses an enforced hierarchical v1 memory controller at its actual sysfs mount", () => {
  const read = fileReader({
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup/ram rw - cgroup cgroup rw,memory\n",
    "/proc/self/cgroup": "7:memory:/worker\n",
    "/sys/fs/cgroup/ram/memory.limit_in_bytes": String(8 * GiB),
    "/sys/fs/cgroup/ram/memory.usage_in_bytes": String(6 * GiB),
    "/sys/fs/cgroup/ram/memory.use_hierarchy": "1",
    "/sys/fs/cgroup/ram/memory.stat": `hierarchical_memory_limit ${8 * GiB}\n`,
    "/sys/fs/cgroup/ram/worker/memory.limit_in_bytes": String(4 * GiB),
    "/sys/fs/cgroup/ram/worker/memory.usage_in_bytes": String(1 * GiB),
    "/sys/fs/cgroup/ram/worker/memory.use_hierarchy": "1",
    "/sys/fs/cgroup/ram/worker/memory.stat": `hierarchical_memory_limit ${4 * GiB}\n`,
  });
  assert.deepEqual(readEffectiveVerifierMemory(read), {
    maxBytes: 4 * GiB,
    currentBytes: 2 * GiB,
  });
});

function fileReader(files: Record<string, string>) {
  return (name: string) => {
    if (!(name in files)) throw Object.assign(new Error("missing file"), { code: "ENOENT" });
    return files[name];
  };
}

function v1Files(): Record<string, string> {
  return {
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup/ram rw - cgroup cgroup rw,memory\n",
    "/proc/self/cgroup": "7:memory:/\n",
    "/sys/fs/cgroup/ram/memory.limit_in_bytes": String(8 * GiB),
    "/sys/fs/cgroup/ram/memory.usage_in_bytes": String(2 * GiB),
    "/sys/fs/cgroup/ram/memory.use_hierarchy": "1",
    "/sys/fs/cgroup/ram/memory.stat": `hierarchical_memory_limit ${8 * GiB}\n`,
  };
}

test("malformed controller metadata cannot be ignored to unlock a different fallback", () => {
  const files = v1Files();
  files["/proc/self/mountinfo"] += "33 1 0:31 / /sys/fs/cgroup/v2 rw - cgroup2 cgroup\n";
  assert.equal(readEffectiveVerifierMemory(fileReader(files)), null);
});

test("a hidden tighter parent is refused even when its limit equals a visible leaf limit", () => {
  const files = v1Files();
  files["/proc/self/mountinfo"] = "32 1 0:30 /tenant /sys/fs/cgroup/ram rw - cgroup cgroup rw,memory\n";
  files["/proc/self/cgroup"] = "7:memory:/tenant/worker\n";
  files["/sys/fs/cgroup/ram/memory.stat"] = `hierarchical_memory_limit ${4 * GiB}\n`;
  files["/sys/fs/cgroup/ram/worker/memory.limit_in_bytes"] = String(4 * GiB);
  files["/sys/fs/cgroup/ram/worker/memory.usage_in_bytes"] = String(GiB);
  files["/sys/fs/cgroup/ram/worker/memory.use_hierarchy"] = "1";
  files["/sys/fs/cgroup/ram/worker/memory.stat"] = `hierarchical_memory_limit ${4 * GiB}\n`;
  assert.equal(readEffectiveVerifierMemory(fileReader(files)), null);
});

test("v2 bind mounts with unobservable parents do not prove safe aggregate headroom", () => {
  const files = {
    "/proc/self/mountinfo": "32 1 0:30 /tenant /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/tenant/worker\n",
    "/sys/fs/cgroup/memory.max": String(8 * GiB),
    "/sys/fs/cgroup/memory.current": String(3 * GiB),
    "/sys/fs/cgroup/worker/memory.max": "max",
  };
  assert.equal(readEffectiveVerifierMemory(fileReader(files)), null);
});

test("v1 rejects non-hierarchical, incomplete, contradictory and unbounded accounting", async (t) => {
  const cases: Array<[string, (files: Record<string, string>) => void]> = [
    ["hierarchy disabled", files => { files["/sys/fs/cgroup/ram/memory.use_hierarchy"] = "0"; }],
    ["missing usage", files => { delete files["/sys/fs/cgroup/ram/memory.usage_in_bytes"]; }],
    ["missing effective limit", files => { delete files["/sys/fs/cgroup/ram/memory.stat"]; }],
    ["contradictory effective limit", files => { files["/sys/fs/cgroup/ram/memory.stat"] = `hierarchical_memory_limit ${9 * GiB}\n`; }],
    ["unknown tighter ancestor", files => { files["/sys/fs/cgroup/ram/memory.stat"] = `hierarchical_memory_limit ${4 * GiB}\n`; }],
    ["unlimited sentinel", files => {
      files["/sys/fs/cgroup/ram/memory.limit_in_bytes"] = "9223372036854771712";
      files["/sys/fs/cgroup/ram/memory.stat"] = "hierarchical_memory_limit 9223372036854771712\n";
    }],
    ["malformed limit", files => { files["/sys/fs/cgroup/ram/memory.limit_in_bytes"] = "NaN"; }],
    ["negative usage", files => { files["/sys/fs/cgroup/ram/memory.usage_in_bytes"] = "-1"; }],
    ["permission denied", files => { delete files["/proc/self/mountinfo"]; }],
    ["unsafe process path", files => { files["/proc/self/cgroup"] = "7:memory:/../outside\n"; }],
    ["duplicate memory memberships", files => { files["/proc/self/cgroup"] += "8:memory:/other\n"; }],
    ["duplicate controller mounts", files => { files["/proc/self/mountinfo"] += files["/proc/self/mountinfo"]; }],
    ["metadata size bound", files => { files["/proc/self/mountinfo"] = "x".repeat(256 * 1024 + 1); }],
    ["ancestry depth bound", files => { files["/proc/self/cgroup"] = `7:memory:/${Array(33).fill("worker").join("/")}\n`; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const files = v1Files();
    change(files);
    assert.equal(readEffectiveVerifierMemory(fileReader(files)), null);
  });
});

test("the production reader and operator diagnostic select the same bounded v2 authority", () => {
  const read = fileReader({
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup/unified rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/worker\n",
    "/sys/fs/cgroup/unified/memory.max": String(8 * GiB),
    "/sys/fs/cgroup/unified/memory.current": String(6 * GiB),
    "/sys/fs/cgroup/unified/worker/memory.max": String(4 * GiB),
    "/sys/fs/cgroup/unified/worker/memory.current": String(GiB),
  });
  assert.deepEqual(readEffectiveVerifierMemory(read), { maxBytes: 4 * GiB, currentBytes: 2 * GiB });
  const diagnostic = readVerifierMemoryDiagnostic(read);
  assert.equal(diagnostic.source, "cgroup-v2");
  assert.deepEqual(diagnostic.snapshot, readEffectiveVerifierMemory(read));
  assert.deepEqual(Object.keys(diagnostic.v2).sort(), ["mounts", "resolved", "state"]);
});

test("an unlimited v1 root can authorize a finite child only with complete hierarchical evidence", () => {
  const files = v1Files();
  files["/proc/self/cgroup"] = "7:memory:/worker\n";
  files["/sys/fs/cgroup/ram/memory.limit_in_bytes"] = "9223372036854771712";
  files["/sys/fs/cgroup/ram/memory.stat"] = "hierarchical_memory_limit 9223372036854771712\n";
  for (const suffix of ["memory.limit_in_bytes", "memory.usage_in_bytes", "memory.use_hierarchy", "memory.stat"]) {
    files[`/sys/fs/cgroup/ram/worker/${suffix}`] = v1Files()[`/sys/fs/cgroup/ram/${suffix}`];
  }
  assert.deepEqual(readEffectiveVerifierMemory(fileReader(files)), { maxBytes: 8 * GiB, currentBytes: 2 * GiB });
});

test("missing accounting or ambiguous active controllers never substitutes host memory", () => {
  const files = v1Files();
  files["/proc/self/mountinfo"] += "33 1 0:31 / /sys/fs/cgroup/unified rw - cgroup2 cgroup rw\n";
  files["/proc/self/cgroup"] += "0::/\n";
  files["/sys/fs/cgroup/unified/memory.max"] = String(8 * GiB);
  files["/sys/fs/cgroup/unified/memory.current"] = String(GiB);
  assert.equal(readEffectiveVerifierMemory(fileReader(files)), null);
  delete files["/sys/fs/cgroup/unified/memory.max"];
  assert.equal(readVerifierMemoryDiagnostic(fileReader(files)).source, "cgroup-v1");
  assert.equal(readEffectiveVerifierMemory(fileReader({
    "/proc/self/mountinfo": "32 1 0:30 / /sys rw - sysfs sysfs rw\n",
    "/proc/self/cgroup": "0::/\n",
    "/proc/meminfo": "MemTotal: 8388608 kB\nMemAvailable: 7340032 kB\n",
  })), null);
});

test("a controller membership without an accessible mount blocks alternate authority", () => {
  const v1 = v1Files();
  v1["/proc/self/cgroup"] += "0::/hidden\n";
  assert.equal(readEffectiveVerifierMemory(fileReader(v1)), null);
  const v2 = {
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/\n7:memory:/hidden\n",
    "/sys/fs/cgroup/memory.max": String(8 * GiB),
    "/sys/fs/cgroup/memory.current": String(GiB),
  };
  assert.equal(readEffectiveVerifierMemory(fileReader(v2)), null);
});

test("finds a finite child cgroup limit even when the mounted root says max", () => {
  const read = fileReader({
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/tenant/worker\n",
    "/sys/fs/cgroup/memory.max": "max\n",
    "/sys/fs/cgroup/tenant/memory.max": "max\n",
    "/sys/fs/cgroup/tenant/worker/memory.max": String(8 * GiB),
    "/sys/fs/cgroup/tenant/worker/memory.current": String(2 * GiB),
  });
  assert.deepEqual(readEffectiveCgroupV2Memory(read), {
    maxBytes: 8 * GiB,
    currentBytes: 2 * GiB,
  });
});

test("uses the tightest headroom and smallest finite limit across the cgroup ancestry", () => {
  const files = {
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/tenant/worker\n",
    "/sys/fs/cgroup/memory.max": String(8 * GiB),
    "/sys/fs/cgroup/memory.current": String(6 * GiB),
    "/sys/fs/cgroup/tenant/memory.max": "max",
    "/sys/fs/cgroup/tenant/worker/memory.max": String(4 * GiB),
    "/sys/fs/cgroup/tenant/worker/memory.current": String(1 * GiB),
  };
  // Child has 3 GiB free, but its parent has just 2 GiB. The maximum must
  // remain 4 GiB even though the tighter headroom belongs to the 8 GiB root.
  assert.deepEqual(readEffectiveCgroupV2Memory(fileReader(files)), {
    maxBytes: 4 * GiB,
    currentBytes: 2 * GiB,
  });
});

test("refuses incomplete v2 ancestry without reading outside its mount", () => {
  const read = fileReader({
    "/proc/self/mountinfo": "32 1 0:30 /tenant /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/tenant/worker\n",
    "/sys/fs/cgroup/memory.max": String(8 * GiB),
    "/sys/fs/cgroup/memory.current": String(3 * GiB),
    "/sys/fs/cgroup/worker/memory.max": "max",
  });
  assert.equal(readEffectiveCgroupV2Memory(read), null);
});

test("does not admit unbounded, missing, malformed or unresolvable cgroups", () => {
  const files = {
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/tenant/worker\n",
    "/sys/fs/cgroup/memory.max": "max",
    "/sys/fs/cgroup/tenant/memory.max": "max",
    "/sys/fs/cgroup/tenant/worker/memory.max": "max",
  };
  assert.equal(readEffectiveCgroupV2Memory(fileReader(files)), null);
  assert.equal(readEffectiveCgroupV2Memory(fileReader({
    ...files,
    "/sys/fs/cgroup/tenant/worker/memory.max": String(8 * GiB),
    // Finite max without matching memory.current is never an admission signal.
  })), null);
  assert.throws(() => readEffectiveCgroupV2Memory(fileReader({
    ...files,
    "/sys/fs/cgroup/tenant/worker/memory.max": "bad-limit",
  })), /malformed/);
  assert.equal(readEffectiveCgroupV2Memory(fileReader({
    ...files,
    "/proc/self/cgroup": "0::/tenant/../outside",
  })), null);
  assert.equal(readEffectiveCgroupV2Memory(fileReader({
    ...files,
    "/proc/self/mountinfo": "32 1 0:30 / /unexpected rw - cgroup2 cgroup rw",
  })), null);
});

test("unavailable-memory diagnostics include only classified source states and aggregate host numbers", () => {
  const summary = summarizeUnavailableVerifierMemory(fileReader({
    "/sys/fs/cgroup/memory.max": "max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes": "private error payload",
    "/proc/self/mountinfo": "32 1 0:30 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/proc/self/cgroup": "0::/worker\n",
    "/sys/fs/cgroup/worker/memory.max": "max",
    "/proc/meminfo": "MemTotal: 8388608 kB\nMemAvailable: 5242880 kB\nSecret: do-not-log\n",
  }), () => 8 * GiB);
  assert.match(summary, /v2_root=unbounded v2_mount=v2_present v2_path=resolved v2_leaf=unbounded v1_fixed=invalid/);
  assert.match(summary, /host_total_gib=8\.00 host_available_gib=5\.00/);
  assert.doesNotMatch(summary, /private|do-not-log|tenant|worker/);
});