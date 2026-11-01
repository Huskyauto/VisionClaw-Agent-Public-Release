import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { memoryBackupCommand } from "../../server/lib/memory-backup-runner";

test("production starts the packaged backup with Node, never npx or a TypeScript loader", () => {
  const command = memoryBackupCommand({ production: true, cwd: "/app", node: "/runtime/node", exists: () => true });
  assert.deepEqual(command, { command: "/runtime/node", args: ["/app/dist/nightly-memory-backup.cjs"] });
});

test("a missing production bundle fails explicitly instead of attempting npx installation", () => {
  assert.throws(() => memoryBackupCommand({ production: true, cwd: "/app", exists: () => false }), /backup bundle missing/);
});

test("development keeps the source runner and the production build includes the backup entry", async () => {
  assert.deepEqual(memoryBackupCommand({ production: false, cwd: "/app" }),
    { command: "npx", args: ["tsx", "scripts/nightly-memory-backup.ts"] });
  assert.match(await readFile("scripts/build.ts", "utf8"), /"scripts\/nightly-memory-backup\.ts"/);
});
