import test from "node:test";
import assert from "node:assert/strict";
import { restrictedCommand } from "../../server/safety/restricted-exec";

test("autonomous execution accepts bounded read-only argument arrays, never shell syntax", () => {
  const allowed = restrictedCommand('head -n 5 "server/code-sandbox.ts"', process.cwd());
  assert.equal(allowed.error, undefined);
  assert.equal(allowed.binary, "/usr/bin/head");
  assert.deepEqual(allowed.args, ["-n", "5", "server/code-sandbox.ts"]);
  for (const command of [
    "cat /proc/$PPID/environ", "cat /proc/1/environ",
    'echo full | tee data/exec-config.json', "awk 'BEGIN {system(\"id\")}'",
    "find . -execdir id ;", "xargs bash -c id", "sed -i x server/index.ts",
    "cat ../../etc/passwd", "cat .env", "cat data/exec-config.json",
    "grep -f .env server/index.ts", "cat /etc/passwd", "cat --help",
    "/tmp/cat server/index.ts", "ls -R .", "echo first\\ncat /etc/passwd",
    "uniq server/code-sandbox.ts server/index.ts",
  ]) {
    assert.ok(restrictedCommand(command, process.cwd()).error, command);
  }
});
