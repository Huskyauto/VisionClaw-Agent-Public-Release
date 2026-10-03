/**
 * tests/unit/render-farm-ffprobe-path.test.ts
 *
 * Repo-wide regression guard against the recurring prod weekly-recap failure
 * class ("could not probe narration audio duration ... ffprobe failed or
 * returned 0"). Root cause: app-box code spawned ffmpeg/ffprobe by BARE NAME,
 * which prod's Reserved-VM overlayFS corrupts (execve EIO). The platform's fix
 * everywhere is server/lib/ffmpeg-paths.ts#getFf{mpeg,probe}Path() — tmpfs
 * relocation + execve probe + system fallback. A bare spawn bypasses ALL of
 * that and fails closed in prod, one new code path each week.
 *
 * This test walks server/ + scripts/ and FAILS CLOSED if any file spawns a bare
 * "ffmpeg"/"ffprobe" — so a future edit can't silently reintroduce the bug.
 *
 * ALLOWLIST: scripts/render-chapter-ffmpeg.mjs runs on GitHub-hosted runners
 * (ffmpeg preinstalled, no overlayFS), so bare ffmpeg is correct THERE only.
 * Allowlisted by EXACT relative path, not basename, so a same-named file in
 * another dir can't accidentally bypass the guard.
 *
 * Run: node --import tsx --test tests/unit/render-farm-ffprobe-path.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";

const ROOT = process.cwd();

// EXACT relative paths where a bare ffmpeg/ffprobe spawn is intentional +
// correct (NOT app-box / not overlayFS-exposed).
const ALLOWLIST = new Set<string>([
  "scripts/render-chapter-ffmpeg.mjs", // executes on GitHub Actions runners, not the prod box
]);

// Matches a bare-string-literal binary as the spawn target, e.g.
//   spawnSync("ffprobe", …)  execFileSync("ffmpeg", …)  spawn('ffprobe', …)
// `[\s]*` (not a single line) so a multiline invocation —
//   spawnSync(
//     "ffmpeg", …)
// — is also caught. Global+multiline so we can report every offender.
// `\s*\(` (not bare `\(`) so `spawnSync ("ffmpeg")` and `spawnSync\n("ffmpeg")`
// — whitespace/newline between the callee and its paren — are also caught.
const BARE_SPAWN = /(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*["'`]ff(?:mpeg|probe)["'`]/g;
const BARE_EXEC_CMD = /execSync\s*\(\s*[`"']\s*ff(?:mpeg|probe)\b/g;

// Same overlayFS execve-corruption threat model, but for the ARCHIVE binary
// `tar` — the prod weekly-recap also died at the render-farm bundling step with
// an opaque "tar failed". The platform fix is pure-JS node-tar (create/extract),
// no system binary. This guard fails closed if a bare `tar` spawn is
// reintroduced. The leading quote means bsdtar/unzip (legitimate fallbacks that
// sit BEHIND the pure-JS adm-zip primary) are NOT matched — only bare "tar".
const BARE_TAR = /(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*["'`]tar["'`]/g;

/**
 * Strip block + line comments, preserving newlines (so reported line numbers
 * stay accurate). Removing comments BOTH closes the `spawnSync /* *​/ (...)`
 * evasion the architect flagged AND prevents false positives from a
 * commented-out bare spawn. Not a full JS parser, but sufficient for a
 * spawn-callsite guard.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) // block comments → spaces (keep \n)
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1) => p1 + ""); // line comments (avoid http://)
}

/** Return [line:snippet] for every bare ffmpeg/ffprobe spawn in `src`. */
function findBareSpawns(rawSrc: string): Array<{ line: number; snippet: string }> {
  const src = stripComments(rawSrc);
  const hits: Array<{ line: number; snippet: string }> = [];
  for (const re of [BARE_SPAWN, BARE_EXEC_CMD]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      hits.push({ line, snippet: m[0].replace(/\s+/g, " ").slice(0, 80) });
    }
  }
  return hits;
}

/** Return [line:snippet] for every bare `tar` spawn in `src`. */
function findBareTar(rawSrc: string): Array<{ line: number; snippet: string }> {
  const src = stripComments(rawSrc);
  const hits: Array<{ line: number; snippet: string }> = [];
  BARE_TAR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_TAR.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ line, snippet: m[0].replace(/\s+/g, " ").slice(0, 80) });
  }
  return hits;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name.startsWith(".")) continue;
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|mjs|js|cjs)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// --- guard-correctness fixtures (prove the detector itself works) --------
test("detector catches bare spawns including MULTILINE invocations", () => {
  const singleLine = `const r = spawnSync("ffprobe", ["-v","error"]);`;
  const multiLine = `const r = spawnSync(\n  "ffmpeg",\n  ["-y"]\n);`;
  const execCmd = `execSync("ffmpeg -i in.mp4 out.mp4");`;
  const spaceBeforeParen = `const r = spawnSync ("ffmpeg", ["-y"]);`;
  const newlineBeforeParen = `const r = spawnSync\n("ffprobe", ["-v","error"]);`;
  assert.equal(findBareSpawns(singleLine).length, 1, "single-line bare spawn must be caught");
  assert.equal(findBareSpawns(multiLine).length, 1, "MULTILINE bare spawn must be caught");
  assert.equal(findBareSpawns(execCmd).length, 1, "bare execSync command must be caught");
  assert.equal(findBareSpawns(spaceBeforeParen).length, 1, "space before ( must be caught");
  assert.equal(findBareSpawns(newlineBeforeParen).length, 1, "newline before ( must be caught");
});

test("detector does NOT flag resolver-routed spawns (no false positives)", () => {
  const resolved = `const r = spawnSync(getFfprobePath(), ["-v","error"]);`;
  const resolvedMulti = `const r = execFileSync(\n  getFfmpegPath(),\n  ["-y"]\n);`;
  assert.equal(findBareSpawns(resolved).length, 0, "resolver call must not be flagged");
  assert.equal(findBareSpawns(resolvedMulti).length, 0, "multiline resolver call must not be flagged");
});

test("comment handling: ignore commented-out spawns, catch comment-separated callee", () => {
  const commentedOut = `// const r = spawnSync("ffmpeg", []);\nconst x = 1;`;
  const blockCommented = `/* spawnSync("ffprobe", []) */ const x = 1;`;
  const inlineComment = `const r = spawnSync /* legacy */ ("ffmpeg", ["-y"]);`;
  assert.equal(findBareSpawns(commentedOut).length, 0, "commented-out spawn must NOT be flagged");
  assert.equal(findBareSpawns(blockCommented).length, 0, "block-commented spawn must NOT be flagged");
  assert.equal(findBareSpawns(inlineComment).length, 1, "comment-separated callee must still be caught");
});

test("detector catches BACKTICK string-literal spawn args", () => {
  const tickSpawn = "const r = spawnSync(`ffmpeg`, [`-y`]);";
  const tickExecFile = "const r = execFileSync(`ffprobe`, [`-v`]);";
  assert.equal(findBareSpawns(tickSpawn).length, 1, "backtick-literal spawn must be caught");
  assert.equal(findBareSpawns(tickExecFile).length, 1, "backtick-literal execFileSync must be caught");
});

// --- repo-wide enforcement -----------------------------------------------
test("no app-box file spawns a BARE ffmpeg/ffprobe (overlayFS execve corruption in prod)", () => {
  const offenders: string[] = [];
  for (const dir of ["server", "scripts"]) {
    for (const file of walk(resolve(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      for (const hit of findBareSpawns(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${hit.line}  ${hit.snippet}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `Bare ffmpeg/ffprobe spawn(s) found — use getFf{mpeg,probe}Path() from server/lib/ffmpeg-paths:\n${offenders.join("\n")}`,
  );
});

// --- bare `tar` guard (same overlayFS threat model, archive binary) ------
test("tar detector catches bare tar spawns but NOT bsdtar/unzip fallbacks", () => {
  assert.equal(findBareTar(`spawnSync("tar", ["-czf", t, "-C", d, "."]);`).length, 1, "bare tar create must be caught");
  assert.equal(findBareTar(`spawnSync("tar", ["-xf", t, "-C", d]);`).length, 1, "bare tar extract must be caught");
  assert.equal(findBareTar(`spawnSync(\n  "tar",\n  args\n);`).length, 1, "multiline bare tar must be caught");
  assert.equal(findBareTar(`spawnSync("bsdtar", ["-xf", z]);`).length, 0, "bsdtar fallback must NOT be flagged");
  assert.equal(findBareTar(`spawnSync("unzip", ["-o", z]);`).length, 0, "unzip fallback must NOT be flagged");
  assert.equal(findBareTar(`await tarCreate({ gzip: true, file: t, cwd: d }, ["."]);`).length, 0, "node-tar must NOT be flagged");
});

test("no app-box file spawns a BARE tar (use pure-JS node-tar create/extract)", () => {
  const offenders: string[] = [];
  for (const dir of ["server", "scripts"]) {
    for (const file of walk(resolve(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (ALLOWLIST.has(rel)) continue;
      for (const hit of findBareTar(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${hit.line}  ${hit.snippet}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `Bare tar spawn(s) found — use pure-JS node-tar create()/extract() instead (prod overlayFS corrupts bare-binary execve):\n${offenders.join("\n")}`,
  );
});

// --- render-farm-specific: lock the exact fix that started this ----------
const farm = readFileSync(resolve(ROOT, "scripts/lib/github-render-farm.ts"), "utf8");

test("render-farm imports getFfprobePath from server/lib/ffmpeg-paths", () => {
  assert.match(farm, /import\s*\{\s*getFfprobePath\s*\}\s*from\s*["']\.\.\/\.\.\/server\/lib\/ffmpeg-paths["']/);
});

test("render-farm routes every ffprobe probe through getFfprobePath()", () => {
  const resolverCalls = (farm.match(/spawnSync\(\s*getFfprobePath\(\)/g) || []).length;
  assert.ok(resolverCalls >= 2, `expected >=2 getFfprobePath() spawn callsites, found ${resolverCalls}`);
});
