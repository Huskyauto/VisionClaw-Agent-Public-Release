import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Spark worker passes its isolated Python recovery and HTTP fixtures", { timeout: 30_000 }, () => {
  const result = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests/python",
    "-p", "test_spark_legion_worker.py", "-v"], {
    encoding: "utf8", timeout: 25_000, maxBuffer: 128_000,
    env: { PATH: process.env.PATH, LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
