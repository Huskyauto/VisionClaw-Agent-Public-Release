import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const runner = path.resolve("node_modules/.bin/tsx");
const script = path.resolve("scripts/build-codebase-graph.ts");
function build(root: string) {
  return spawnSync(runner, [script], { cwd: root, encoding: "utf8",
    timeout: 30_000, maxBuffer: 256 * 1024 });
}

test("builds accurate inventory-only edges through the real CLI", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "graph-fixture-"));
  try {
    await mkdir(path.join(root, "server"));
    await mkdir(path.join(root, "shared"));
    await writeFile(path.join(root, "server/main.ts"), `
// import nope from "./ghost";
export { Public as PublicAlias } from "@shared/types.js";
async function load() { return import("./worker.js"); }
const example = \`import bad from "./ghost"\`;
const external = require("example-package");
import outside from "../outside";
import linked from "./linked";
`);
    await writeFile(path.join(root, "server/worker.ts"), "export const worker = 1;");
    await writeFile(path.join(root, "server/ghost.ts"), "export const ghost = 1;");
    await writeFile(path.join(root, "shared/types.ts"), "export interface Public {}");
    await writeFile(path.join(root, "outside.ts"), "export default 1;");
    await symlink(path.join(root, "outside.ts"), path.join(root, "server/linked.ts"));
    const result = build(root);
    assert.equal(result.status, 0, result.stderr);
    const graph = JSON.parse(await readFile(path.join(root, "data/codebase-graph.json"), "utf8"));
    assert.equal(graph.schemaVersion, 1);
    assert.equal(graph.fileCount, 4);
    assert.deepEqual(graph.edges, [
      { from: "server/main.ts", to: "server/worker.ts" },
      { from: "server/main.ts", to: "shared/types.ts" },
    ]);
    assert.deepEqual(graph.nodes.find((n: { id: string }) => n.id === "server/main.ts").exports, ["PublicAlias"]);
    assert.ok(graph.topExternalDeps.some((p: { pkg: string }) => p.pkg === "example-package"));
    // Exercise the existing agent-facing consumers against this generated file.
    const moduleUrl = new URL(`file://${path.resolve("server/lib/codebase-graph.ts")}`).href;
    const consumer = spawnSync(runner, ["-e", `(async () => {
      const { queryGraph, computeDiffImpact } = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({
        query: await queryGraph({file:"server/worker.ts"}),
        impact: await computeDiffImpact({changedFiles:["server/worker.ts"],depth:2})
      }));
    })().catch(() => process.exit(1));`], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024,
    });
    assert.equal(consumer.status, 0, consumer.stderr);
    const { query, impact } = JSON.parse(consumer.stdout);
    assert.deepEqual(query.matches[0].dependedOnBy, ["server/main.ts"]);
    assert.deepEqual(impact.directCallers, ["server/main.ts"]);
    assert.deepEqual(impact.changedOutOfGraph, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("oversized source fails explicitly and leaves the last complete graph intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "graph-fixture-limit-"));
  try {
    await mkdir(path.join(root, "server"));
    await mkdir(path.join(root, "data"));
    const old = '{"previous":"complete"}';
    await writeFile(path.join(root, "data/codebase-graph.json"), old);
    await writeFile(path.join(root, "server/large.ts"), Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    const result = build(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /size\/type bounds/);
    assert.equal(await readFile(path.join(root, "data/codebase-graph.json"), "utf8"), old);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an empty inventory never overwrites a prior graph", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "graph-fixture-empty-"));
  try {
    await mkdir(path.join(root, "data"));
    await writeFile(path.join(root, "data/codebase-graph.json"), "prior");
    const result = build(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No source files/);
    assert.equal(await readFile(path.join(root, "data/codebase-graph.json"), "utf8"), "prior");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("symlinked source roots and output directories are refused", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "graph-fixture-links-"));
  try {
    await mkdir(path.join(root, "external"));
    await writeFile(path.join(root, "external/file.ts"), "export const x = 1;");
    await symlink(path.join(root, "external"), path.join(root, "server"));
    assert.equal(build(root).status, 1);
    await rm(path.join(root, "server"));
    await mkdir(path.join(root, "server"));
    await writeFile(path.join(root, "server/file.ts"), "export const x = 1;");
    await writeFile(path.join(root, "external/codebase-graph.json"), "outside");
    await symlink(path.join(root, "external"), path.join(root, "data"));
    assert.equal(build(root).status, 1);
    assert.equal(await readFile(path.join(root, "external/codebase-graph.json"), "utf8"), "outside");
  } finally { await rm(root, { recursive: true, force: true }); }
});
