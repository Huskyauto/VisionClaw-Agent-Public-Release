/**
 * tests/unit/eio-read.test.ts
 *
 * Covers the EIO-retry read helper (scripts/lib/eio-read.ts) used by the
 * GitHub render-farm path. Replit Reserved VM overlayFS intermittently throws
 * EIO on ordinary reads; this helper retries ONLY on EIO, surfaces every other
 * error immediately, and re-throws the EIO once retries are exhausted so the
 * render still fails closed on a genuinely dead disk.
 *
 * Monkeypatches the shared `node:fs` default export (same module object the
 * helper imports) — no real disk read, no pg pool, so node:test never hangs.
 *
 * Run: node --import tsx --test tests/unit/eio-read.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSyncEIO, copyFileSyncEIO, retryEIOAsync, statSyncEIO, readdirSyncEIO } from "../../scripts/lib/eio-read";
import { findUnguardedFsOps } from "../../scripts/lib/eio-guard";

const orig = fs.readFileSync;
const origCopy = fs.copyFileSync;
const origStat = fs.statSync;
const origReaddir = fs.readdirSync;

function eio(): NodeJS.ErrnoException {
  const e = new Error("EIO: i/o error, read") as NodeJS.ErrnoException;
  e.code = "EIO";
  return e;
}

test("retries on EIO then succeeds, returning the eventual value", () => {
  let calls = 0;
  (fs as any).readFileSync = (_p: string, _enc?: any) => {
    calls += 1;
    if (calls < 3) throw eio();
    return "OK";
  };
  try {
    const out = readFileSyncEIO("whatever", "utf8");
    assert.equal(out, "OK");
    assert.equal(calls, 3);
  } finally {
    (fs as any).readFileSync = orig;
  }
});

test("non-EIO errors (ENOENT) surface immediately without retry", () => {
  let calls = 0;
  (fs as any).readFileSync = () => {
    calls += 1;
    const e = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    e.code = "ENOENT";
    throw e;
  };
  try {
    assert.throws(() => readFileSyncEIO("missing", "utf8"), /ENOENT/);
    assert.equal(calls, 1, "must not retry on a non-EIO error");
  } finally {
    (fs as any).readFileSync = orig;
  }
});

test("re-throws the original EIO once retries are exhausted (fail-closed)", () => {
  let calls = 0;
  (fs as any).readFileSync = () => {
    calls += 1;
    throw eio();
  };
  try {
    assert.throws(() => readFileSyncEIO("dead-disk", "utf8", 3), /EIO/);
    assert.equal(calls, 3, "must attempt exactly `tries` times then give up");
  } finally {
    (fs as any).readFileSync = orig;
  }
});

test("buffer overload (no encoding) round-trips the bytes", () => {
  (fs as any).readFileSync = () => Buffer.from([1, 2, 3]);
  try {
    const b = readFileSyncEIO("bin");
    assert.ok(Buffer.isBuffer(b));
    assert.equal((b as Buffer).length, 3);
  } finally {
    (fs as any).readFileSync = orig;
  }
});

// ── copyFileSyncEIO (bundle-assembly copies of scene image / audio / renderer) ──

test("copyFileSyncEIO retries on EIO then succeeds", () => {
  let calls = 0;
  (fs as any).copyFileSync = () => {
    calls += 1;
    if (calls < 3) throw eio();
  };
  try {
    copyFileSyncEIO("src", "dest");
    assert.equal(calls, 3);
  } finally {
    (fs as any).copyFileSync = origCopy;
  }
});

test("copyFileSyncEIO surfaces a non-EIO error immediately (no retry)", () => {
  let calls = 0;
  (fs as any).copyFileSync = () => {
    calls += 1;
    const e = new Error("ENOSPC: no space left") as NodeJS.ErrnoException;
    e.code = "ENOSPC";
    throw e;
  };
  try {
    assert.throws(() => copyFileSyncEIO("src", "dest"), /ENOSPC/);
    assert.equal(calls, 1);
  } finally {
    (fs as any).copyFileSync = origCopy;
  }
});

test("copyFileSyncEIO re-throws the EIO once exhausted (fail-closed)", () => {
  let calls = 0;
  (fs as any).copyFileSync = () => {
    calls += 1;
    throw eio();
  };
  try {
    assert.throws(() => copyFileSyncEIO("src", "dest", 3), /EIO/);
    assert.equal(calls, 3);
  } finally {
    (fs as any).copyFileSync = origCopy;
  }
});

// ── retryEIOAsync (wraps node-tar create, which fs.reads every bundle file) ──

test("retryEIOAsync retries the whole op on EIO then resolves", async () => {
  let calls = 0;
  const out = await retryEIOAsync("tar", async () => {
    calls += 1;
    if (calls < 3) throw eio();
    return "done";
  });
  assert.equal(out, "done");
  assert.equal(calls, 3);
});

test("retryEIOAsync surfaces a non-EIO rejection immediately (no retry)", async () => {
  let calls = 0;
  await assert.rejects(
    retryEIOAsync("tar", async () => {
      calls += 1;
      const e = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    }),
    /EACCES/,
  );
  assert.equal(calls, 1);
});

test("retryEIOAsync re-throws the EIO once exhausted (fail-closed)", async () => {
  let calls = 0;
  await assert.rejects(
    retryEIOAsync("tar", async () => {
      calls += 1;
      throw eio();
    }, 3),
    /EIO/,
  );
  assert.equal(calls, 3);
});

// ── statSyncEIO (functional stats: result-sidecar mtime, final-MP4 file_size) ──

test("statSyncEIO retries on EIO then returns the stats", () => {
  let calls = 0;
  (fs as any).statSync = () => {
    calls += 1;
    if (calls < 3) throw eio();
    return { size: 42, mtimeMs: 7 } as any;
  };
  try {
    const st = statSyncEIO("f");
    assert.equal(st.size, 42);
    assert.equal(calls, 3);
  } finally {
    (fs as any).statSync = origStat;
  }
});

test("statSyncEIO surfaces ENOENT immediately and re-throws EIO once exhausted", () => {
  (fs as any).statSync = () => {
    const e = new Error("ENOENT") as NodeJS.ErrnoException;
    e.code = "ENOENT";
    throw e;
  };
  try {
    assert.throws(() => statSyncEIO("missing"), /ENOENT/);
  } finally {
    (fs as any).statSync = origStat;
  }
  let calls = 0;
  (fs as any).statSync = () => { calls += 1; throw eio(); };
  try {
    assert.throws(() => statSyncEIO("dead", 3), /EIO/);
    assert.equal(calls, 3);
  } finally {
    (fs as any).statSync = origStat;
  }
});

// ── readdirSyncEIO (result-sidecar discovery in the orchestrator) ──

test("readdirSyncEIO retries on EIO then returns the listing", () => {
  let calls = 0;
  (fs as any).readdirSync = () => {
    calls += 1;
    if (calls < 2) throw eio();
    return ["a.result.json", "b.result.json"];
  };
  try {
    const out = readdirSyncEIO("dir");
    assert.deepEqual(out, ["a.result.json", "b.result.json"]);
    assert.equal(calls, 2);
  } finally {
    (fs as any).readdirSync = origReaddir;
  }
});

test("readdirSyncEIO surfaces a non-EIO error immediately and re-throws EIO once exhausted", () => {
  (fs as any).readdirSync = () => {
    const e = new Error("ENOTDIR") as NodeJS.ErrnoException;
    e.code = "ENOTDIR";
    throw e;
  };
  try {
    assert.throws(() => readdirSyncEIO("notdir"), /ENOTDIR/);
  } finally {
    (fs as any).readdirSync = origReaddir;
  }
  let calls = 0;
  (fs as any).readdirSync = () => { calls += 1; throw eio(); };
  try {
    assert.throws(() => readdirSyncEIO("dead", 3), /EIO/);
    assert.equal(calls, 3);
  } finally {
    (fs as any).readdirSync = origReaddir;
  }
});

// ── regression guard: no raw overlayFS reads/copies in the bundle-assembly path ──
// The recap died because a single un-wrapped copy/read slipped through; this
// static check fails CI if a raw `fs.copyFileSync(` is reintroduced into the
// render path. The recap kept dying for ~3h of firefighting because each EIO
// surfaced one un-wrapped op at a time. This guard locks the hardening in place:
// every raw overlayFS READ-class op (readFileSync/copyFileSync/statSync/readdirSync)
// on a render-path file must EITHER go through an eio-read helper (readFileSyncEIO,
// copyFileSyncEIO, statSyncEIO, readdirSyncEIO — which won't match `fs.<op>(`),
// OR carry an inline `eio-safe:` justification (cosmetic/guarded/best-effort).
// A new raw, unjustified op fails CI here, forcing the author to make a conscious
// EIO decision before it can ever reach a paid production render.
// Enforced by the AST guard in scripts/lib/eio-guard.ts (findUnguardedFsOps) — line
// regexes were evadable by multi-line / aliased / computed-property calls.
const RENDER_PATH_FILES = [
  "scripts/build-bwb-weekly.ts",
  "scripts/bwb-weekly-orchestrator.ts",
  "scripts/build-bwb-video.ts",
  "scripts/lib/github-render-farm.ts",
  "scripts/render-github-generic.ts",
  "scripts/bwb-render-github.ts",
];

for (const rel of RENDER_PATH_FILES) {
  test(`${rel}: every raw overlayFS read-class op is EIO-handled or marked eio-safe`, () => {
    const src = orig(new URL(`../../${rel}`, import.meta.url), "utf8") as string;
    const offenders = findUnguardedFsOps(src, rel).map((o) => `  ${rel}:${o.line}  ${o.text}`);
    assert.equal(
      offenders.length,
      0,
      `Raw overlayFS op(s) on the BWB render path with no EIO handling:\n${offenders.join("\n")}\n` +
        `Fix: route through an eio-read helper (readFileSyncEIO/copyFileSyncEIO/statSyncEIO/readdirSyncEIO), ` +
        `OR if it is genuinely safe (inside a try/catch that falls through, or a cosmetic log) add an inline "eio-safe: <reason>" comment.`,
    );
  });
}

// ── soundness fixtures: the guard must CATCH the evasion patterns a line regex missed ──
test("eio-guard catches a multi-line fs call", () => {
  const src = `import fs from "node:fs";\nconst s = fs\n  .statSync(p).size;`;
  const off = findUnguardedFsOps(src);
  assert.equal(off.length, 1);
  assert.equal(off[0].op, "statSync");
});

test("eio-guard catches an aliased fs binding (const f = fs)", () => {
  const src = `import fs from "node:fs";\nconst f = fs;\nconst s = f.statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches alias-of-alias (const g = f = fs)", () => {
  const src = `import fs from "node:fs";\nconst f = fs;\nconst g = f;\nconst s = g.readdirSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches computed-property access fs[\"statSync\"]", () => {
  const src = `import fs from "node:fs";\nconst s = fs["statSync"](p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches a bare named import { statSync }", () => {
  const src = `import { statSync } from "node:fs";\nconst s = statSync(p);`;
  const off = findUnguardedFsOps(src);
  assert.equal(off.length, 1);
  assert.equal(off[0].op, "statSync");
});

test("eio-guard catches require()'d fs", () => {
  const src = `const fs = require("fs");\nconst s = fs.readFileSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches destructuring off fs (const { statSync } = fs)", () => {
  const src = `import fs from "node:fs";\nconst { statSync } = fs;\nconst s = statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches destructuring off require (const { statSync } = require)", () => {
  const src = `const { statSync } = require("fs");\nconst s = statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches renamed destructuring (const { readFileSync: rf } = fs)", () => {
  const src = `import fs from "node:fs";\nconst { readFileSync: rf } = fs;\nconst s = rf(p);`;
  const off = findUnguardedFsOps(src);
  assert.equal(off.length, 1);
  assert.equal(off[0].op, "readFileSync");
});

test("eio-guard catches assignment alias (let f; f = fs)", () => {
  const src = `import fs from "node:fs";\nlet f;\nf = fs;\nconst s = f.statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches member-extraction alias (const s = fs.statSync)", () => {
  const src = `import fs from "node:fs";\nconst s = fs.statSync;\nconst r = s(p);`;
  const off = findUnguardedFsOps(src);
  assert.equal(off.length, 1);
  assert.equal(off[0].op, "statSync");
});

test("eio-guard catches member-extraction off require (const s = require(\"fs\").readFileSync)", () => {
  const src = `const s = require("fs").readFileSync;\nconst r = s(p);`;
  const off = findUnguardedFsOps(src);
  assert.equal(off.length, 1);
  assert.equal(off[0].op, "readFileSync");
});

test("eio-guard catches computed member-extraction (const s = fs[\"statSync\"])", () => {
  const src = `import fs from "node:fs";\nconst s = fs["statSync"];\nconst r = s(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard catches assignment member-extraction (let s; s = fs.statSync)", () => {
  const src = `import fs from "node:fs";\nlet s;\ns = fs.statSync;\nconst r = s(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard does NOT treat a string literal containing eio-safe as a marker", () => {
  const src = `import fs from "node:fs";\nconst label = "eio-safe: not a real comment";\nconst s = fs.statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});

test("eio-guard passes a same-line eio-safe marker", () => {
  const src = `import fs from "node:fs";\nconst s = fs.statSync(p); // eio-safe: cosmetic`;
  assert.equal(findUnguardedFsOps(src).length, 0);
});

test("eio-guard passes a preceding-line eio-safe marker", () => {
  const src = `import fs from "node:fs";\n// eio-safe: guarded\nconst s = fs.statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 0);
});

test("eio-guard ignores helper calls and non-fs objects", () => {
  const src = `import { statSyncEIO } from "./lib/eio-read";\nconst a = statSyncEIO(p);\nconst b = foo.statSync(p);\nconst c = db.readFileSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 0);
});

test("eio-guard does not bless an unrelated op via a far-away eio-safe comment", () => {
  // marker on line 2 must NOT cover the raw op on line 4
  const src = `import fs from "node:fs";\n// eio-safe: this is about something else\nconst x = 1;\nconst s = fs.statSync(p);`;
  assert.equal(findUnguardedFsOps(src).length, 1);
});
