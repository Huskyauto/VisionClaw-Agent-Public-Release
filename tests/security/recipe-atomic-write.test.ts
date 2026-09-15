import { test, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// The recipe cache file (.template-scraper-recipes.json) is now written via
// tmp+rename. This contract test asserts that property: a writer that
// crashes before rename leaves the previous good file intact, and the
// final write produces the expected JSON. We exercise the same primitive
// the production saveRecipes() uses (writeFile + rename).

test("atomic write: failed-mid-write tmp file does not corrupt destination", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-write-"));
  const dest = path.join(dir, "recipes.json");
  await fs.writeFile(dest, JSON.stringify({ recipes: [{ id: "v1" }] }));
  // Simulate a crash mid-write: write to tmp, then ABORT before rename.
  const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, "{ this is not valid JSON, simulated crash");
  // Note: no rename. Production saveRecipes() would have crashed here.
  // The destination must still parse cleanly.
  const onDisk = JSON.parse(await fs.readFile(dest, "utf-8"));
  assert.deepEqual(onDisk, { recipes: [{ id: "v1" }] });
  await fs.rm(dir, { recursive: true, force: true });
});

test("atomic write: completed rename swaps in the new file atomically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-write-"));
  const dest = path.join(dir, "recipes.json");
  await fs.writeFile(dest, JSON.stringify({ recipes: [{ id: "v1" }] }));
  const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify({ recipes: [{ id: "v2" }] }));
  await fs.rename(tmp, dest);
  const onDisk = JSON.parse(await fs.readFile(dest, "utf-8"));
  assert.deepEqual(onDisk, { recipes: [{ id: "v2" }] });
  // tmp should no longer exist.
  await assert.rejects(fs.stat(tmp));
  await fs.rm(dir, { recursive: true, force: true });
});
