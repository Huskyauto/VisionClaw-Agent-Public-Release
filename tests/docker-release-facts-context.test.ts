import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { minimatch } from "minimatch";
import { build } from "esbuild";
import { LEGION_RUNBOOKS } from "../server/legion/runbook-source";
import { stageLegionRunbooks } from "../scripts/stage-legion-binaries";
import { isPublicMirror } from "../scripts/lib/build-data-policy";

// Evaluate ordered Docker patterns against a file and its parent directories.
// These cases exercise the docs allowlist, not Git's different ignore rules.
function included(path: string): boolean {
  const rules = readFileSync(".dockerignore", "utf8").split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const segments = path.split("/");
  const paths = segments.map((_, index) => segments.slice(0, index + 1).join("/"));
  let allowed = true;
  for (const rule of rules) {
    const exception = rule.startsWith("!");
    const pattern = (exception ? rule.slice(1) : rule).replace(/^\/|\/$/g, "");
    if (paths.some((candidate) => minimatch(candidate, pattern, { dot: true }))) {
      allowed = exception;
    }
  }
  return allowed;
}

test("Docker context bundles the actual prepublication notice without exposing other docs", async () => {
  assert.equal(included("docs/release-facts.json"), true, "frontend release facts are missing from Docker context");
  for (const path of ["docs/schema-snapshot.sql", "docs/FOR-EXTERNAL-REVIEWERS.md", "docs/private/nested.json"]) {
    assert.equal(included(path), false, `${path} must remain excluded`);
  }
  const stage = mkdtempSync(join(tmpdir(), "release-facts-context-"));
  try {
    for (const path of ["client/src/components/prepublication-notice.tsx", "docs/release-facts.json"]) {
      assert.equal(included(path), true);
      mkdirSync(dirname(join(stage, path)), { recursive: true });
      copyFileSync(path, join(stage, path));
    }
    await build({
      absWorkingDir: stage,
      entryPoints: ["client/src/components/prepublication-notice.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      external: ["react", "react/*"],
      logLevel: "silent",
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test("Docker context includes the Markdown procedure imported by the billing workbench", () => {
  const source = readFileSync("client/src/pages/admin-finished-not-billed.tsx", "utf8");
  const procedure = source.match(/from "\.\.\/\.\.\/\.\.\/(docs\/[^"]+\.md)\?raw"/)?.[1];
  assert.equal(procedure, "docs/finished-but-not-billed.md");
  assert.equal(included(procedure), true, "the Vite raw import must survive Docker context filtering");
  assert.ok(readFileSync(procedure, "utf8").includes("Finished but Not Billed"));
  assert.equal(included("docs/app-review-2026-11-19.md"), false);
});

test("Docker context stages exactly the three screened Legion runbooks, not private agent state", async () => {
  if (isPublicMirror()) {
    assert.equal(included("tests/public-test-manifest.json"), true, "Docker must detect the sanitized edition");
    assert.equal(existsSync(".agents"), false, "the mirror must not contain private workspace sources");
    return;
  }
  const required = new Set<string>(LEGION_RUNBOOKS);
  function checkTree(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) checkTree(path);
      else assert.equal(included(path), required.has(path), `Docker agent-file allowlist drift: ${path}`);
    }
  }
  checkTree(".agents/skills");
  for (const path of [".agents/memory/MEMORY.md", ".agents/users/owner/profile.md",
    ".agents/skills/tdd/private.json", ".agents/skills/zoom-out/references/private.md",
    ".agents/skills/module-girth-guard/SKILL.md.bak"]) {
    assert.equal(included(path), false, `private or unapproved agent data must remain excluded: ${path}`);
  }
  const original = process.cwd();
  const stage = mkdtempSync(join(tmpdir(), "legion-context-"));
  try {
    for (const path of LEGION_RUNBOOKS) {
      assert.equal(included(path), true, `required runbook missing from Docker context: ${path}`);
      mkdirSync(dirname(join(stage, path)), { recursive: true });
      copyFileSync(path, join(stage, path));
    }
    process.chdir(stage);
    await stageLegionRunbooks();
    for (const [index, path] of LEGION_RUNBOOKS.entries()) {
      assert.equal(readFileSync(join(stage, "dist/legion/runbooks", `${index}.md`), "utf8"),
        readFileSync(join(original, path), "utf8"));
    }
  } finally {
    process.chdir(original);
    rmSync(stage, { recursive: true, force: true });
  }
});