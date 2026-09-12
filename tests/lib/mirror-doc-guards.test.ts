/**
 * Pins the fail-closed behavior of the public-mirror doc guards
 * (scripts/lib/mirror-doc-guards.ts, used by stages 0.1/0.2 of
 * scripts/build-public-mirror.sh via verify-mirror-persona-count.ts /
 * verify-mirror-tool-count.ts).
 *
 * No live DB, no real registry import — pure fixtures. The point is that a
 * future refactor of the doc table format, the registry accessor, or the
 * policy shape can never make the guard pass VACUOUSLY (e.g. regex matches
 * zero rows AND header parse fails the same way).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkToolsDoc,
  checkPersonasDoc,
  parseToolDocRows,
  parseToolDocHeaderCount,
  parsePersonaDocSectionCount,
} from "../../scripts/lib/mirror-doc-guards";

function toolsDoc(names: string[], headerCount = names.length): string {
  return [
    `# Tools`,
    ``,
    `The platform exposes **${headerCount} public tools**.`,
    ``,
    `| Tool | Description |`,
    `| --- | --- |`,
    ...names.map((n) => `| \`${n}\` | does ${n} |`),
    ``,
  ].join("\n");
}

const REGISTERED = ["alpha_tool", "beta_tool", "gamma_tool", "trusted_tool"];
const TRUSTED_ONLY = ["trusted_tool"];
const PUBLIC = ["alpha_tool", "beta_tool", "gamma_tool"];

// ---------------------------------------------------------------- tools guard

test("tools guard: matching doc passes", () => {
  const r = checkToolsDoc(toolsDoc(PUBLIC), REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, true);
});

test("tools guard: dropped tool row fails", () => {
  const doc = toolsDoc(["alpha_tool", "beta_tool"], 2); // internally consistent, but missing gamma_tool
  const r = checkToolsDoc(doc, REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
  assert.match(r.message, /Missing from doc \(1\): gamma_tool/);
});

test("tools guard: add+drop pair that nets to zero is still caught (name sets, not counts)", () => {
  const doc = toolsDoc(["alpha_tool", "beta_tool", "rogue_tool"], 3);
  const r = checkToolsDoc(doc, REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
  assert.match(r.message, /gamma_tool/);
  assert.match(r.message, /rogue_tool/);
});

test("tools guard: trusted-only tool listed publicly fails", () => {
  const doc = toolsDoc([...PUBLIC, "trusted_tool"], 4);
  const r = checkToolsDoc(doc, REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
  assert.match(r.message, /not registered publicly \(1\): trusted_tool/);
});

test("tools guard: header/row drift fails", () => {
  const doc = toolsDoc(PUBLIC, 99);
  const r = checkToolsDoc(doc, REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
  assert.match(r.message, /internally inconsistent/);
});

test("tools guard: duplicate rows fail", () => {
  const doc = toolsDoc([...PUBLIC, "alpha_tool"], 4);
  const r = checkToolsDoc(doc, REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
  assert.match(r.message, /duplicate tool rows/);
});

test("tools guard: table-format drift (regex matches zero rows) cannot pass vacuously", () => {
  // Simulate a future reformat: rows no longer match the "| `name` |" shape,
  // AND the header prose changed so the count parse fails too. Zero rows vs
  // header -1 must fail closed, never 0===0 pass.
  const doc = [
    `# Tools`,
    ``,
    `Public tools: 3`,
    ``,
    ...PUBLIC.map((n) => `- ${n}: does ${n}`),
  ].join("\n");
  assert.equal(parseToolDocRows(doc).length, 0);
  assert.equal(parseToolDocHeaderCount(doc), -1);
  const r = checkToolsDoc(doc, REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
});

test("tools guard: empty/blank doc fails", () => {
  const r = checkToolsDoc("", REGISTERED, TRUSTED_ONLY);
  assert.equal(r.ok, false);
});

test("tools guard: empty registry fails closed even when doc is empty-consistent", () => {
  // Doc claims 0 tools consistently; an empty authoritative surface must
  // still fail (registry unreadable), never pass as 0===0.
  const doc = toolsDoc([], 0);
  const r = checkToolsDoc(doc, [], []);
  assert.equal(r.ok, false);
  assert.match(r.message, /registry loaded EMPTY/);
});

test("tools guard script: missing docs/tools.md exits 1 (fail closed)", () => {
  // Run the real script with a cwd INSIDE the repo (module resolution intact —
  // see tsx-probe-outside-workspace) that has no docs/tools.md.
  const emptyCwd = fs.mkdtempSync(path.join(process.cwd(), "tests/fixtures/mirror-guard-"));
  try {
    const res = spawnSync(
      "npx",
      ["tsx", path.join(process.cwd(), "scripts/verify-mirror-tool-count.ts")],
      { cwd: emptyCwd, encoding: "utf8", timeout: 50_000 },
    );
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}; stderr: ${res.stderr}`);
    assert.match(res.stderr, /missing/);
  } finally {
    fs.rmSync(emptyCwd, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- personas guard

function personasDoc(names: string[], headerCount = names.length): string {
  return [
    `# Personas`,
    ``,
    `The platform ships **${headerCount} personas**.`,
    ``,
    ...names.flatMap((n, i) => [`## ${i + 1}. ${n}`, ``, `${n} does things.`, ``]),
  ].join("\n");
}

test("personas guard: matching doc passes", () => {
  const r = checkPersonasDoc(personasDoc(["Felix", "Teagan", "Hermes"]), 3);
  assert.equal(r.ok, true);
});

test("personas guard: dropped persona section fails", () => {
  const r = checkPersonasDoc(personasDoc(["Felix", "Teagan"], 2), 3);
  assert.equal(r.ok, false);
  assert.match(r.message, /lists 2 personas but the platform has 3/);
});

test("personas guard: header/section drift fails", () => {
  const r = checkPersonasDoc(personasDoc(["Felix", "Teagan", "Hermes"], 99), 3);
  assert.equal(r.ok, false);
  assert.match(r.message, /internally inconsistent/);
});

test("personas guard: section-format drift cannot pass vacuously", () => {
  // Headers reformatted away from "## <n>. <Name>" AND prose count line
  // dropped → 0 sections vs -1 header → fail closed.
  const doc = ["# Personas", "", "### Felix", "### Teagan"].join("\n");
  assert.equal(parsePersonaDocSectionCount(doc), 0);
  const r = checkPersonasDoc(doc, 2);
  assert.equal(r.ok, false);
});

test("personas guard: zero/invalid active count fails closed", () => {
  const doc = personasDoc([], 0);
  for (const bad of [0, -1, NaN, 1.5]) {
    const r = checkPersonasDoc(doc, bad as number);
    assert.equal(r.ok, false, `activeCount=${bad} must fail closed`);
  }
});
