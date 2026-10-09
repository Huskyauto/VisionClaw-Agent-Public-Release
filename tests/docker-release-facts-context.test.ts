import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { minimatch } from "minimatch";
import { build } from "esbuild";

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