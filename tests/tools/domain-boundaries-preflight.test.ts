import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const script = path.resolve("scripts/preflight-domain-boundaries.ts");
const loader = require.resolve("tsx");
const config = path.resolve("tsconfig.json");

function scan(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domain-boundary-test-"));
  try {
    const alpha = path.join(dir, "server/tools/domains/alpha");
    const beta = path.join(dir, "server/tools/domains/beta");
    fs.mkdirSync(alpha, { recursive: true });
    fs.mkdirSync(beta, { recursive: true });
    fs.writeFileSync(path.join(alpha, "main.ts"), source);
    fs.writeFileSync(path.join(beta, "mod.ts"), "export const x = 1;");
    const result = spawnSync(process.execPath, ["--import", loader, script], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, CI: "true", TSX_TSCONFIG_PATH: config },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, "checker must exit rather than be terminated");
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("domain checker rejects literal sibling imports regardless of syntax or line wrapping", () => {
  for (const source of [
    'import { x } from "../beta/mod";',
    'import "../beta/mod";',
    'import(\n "../beta/mod"\n);',
    'export * from "../beta/mod";',
    'require(\n "../beta/mod"\n);',
    'module.require("../beta/mod");',
    'module["require"]("../beta/mod");',
    'import x = require("../beta/mod");',
    'type X = import("../beta/mod").X;',
    'import(`../beta/mod`);',
    String.raw`import "../be\u0074a/mod";`,
  ]) {
    const result = scan(source);
    assert.equal(result.status, 1, `must reject ${source}: ${result.output}`);
    assert.match(result.output, /alpha → beta/);
  }
});

test("domain checker accepts same-domain and external imports and ignores comment/string contents", () => {
  const result = scan(`
    import "./local";
    import { readFile } from "node:fs";
    // import "../beta/mod";
    /* require(
      "../beta/mod"
    ); */
    const example = 'import("../beta/mod")';
    const ordinaryCall = require.resolve("./local");
  `);
  assert.equal(result.status, 0, result.output);
});

test("domain checker refuses non-literal targets even with line wrapping", () => {
  const result = scan("import(\n target\n); require(`../${domain}/mod`);");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /unresolvable/);
});

test("domain checker rejects malformed source instead of claiming complete coverage", () => {
  const result = scan('import { from "../beta/mod";');
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /malformed source/);
});
