"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { prepareSnapshot: runPrepareSnapshot } = require("../../scripts/prepare-publish-snapshot.cjs");
const assets = [
  "visionclaw-self-audit-2026-05-24.md", "visionclaw-self-audit-2026-05-24.pdf",
  "audit-pitch-bob.mp3", "Bob_on_Mounjaro_—_Channel_Avatar_1777847875921.png",
  "Vision_Claw_Logo_Final-01_1776037691274.png",
];
const nativeContext = {
  VISIONCLAW_PUBLISH_SNAPSHOT: "1", REPL_ID: "00000000-0000-4000-8000-000000000099",
};
const workspaceHost = { workspaceEditor: true };
const builderHost = { workspaceEditor: false };
const prepareSnapshot = options => runPrepareSnapshot({ readHost: () => builderHost, ...options });

function put(root, file, text = "fixture") {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

function hostPreload(root, host) {
  const file = path.join(root, "fixture-host.cjs");
  // Test-only editor-process instrumentation. Filesystem identity stays real.
  put(root, "fixture-host.cjs", `
    const fs=require("node:fs"),read=fs.readFileSync;
    fs.readFileSync=function(file,...args){
      if(/^\\/proc\\/\\d+\\/comm$/.test(file))return "${host.workspaceEditor ? "nix-editor" : "node"}\\n";
      return read.call(this,file,...args);
    };
  `);
  return file;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "generated-artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "generated-artifacts", "original.mp4"), "retain original");
  const files = [
    "package.json", ".replit", "scripts/build.ts", "server/index.ts", "client/src/main.tsx",
    "dist/index.cjs", "dist/proposal-verifier-child.cjs", "dist/lib.es5.d.ts",
    "dist/copilot-chat-worker.mjs", "dist/legion/bin/tailscale", "dist/legion/bin/tailscaled",
    "node_modules/helmet/package.json", "uploads/customer.pdf", "data/retained-report.md",
    "project-assets/customer-tool.html",
  ];
  for (const file of files) {
    put(root, file, "runtime fixture");
  }
  put(root, "package.json", JSON.stringify({ private: true, name: "publish-snapshot-fixture" }));
  put(root, "scripts/run-primary-only.sh", 'PRIMARY_REPL_ID="00000000-0000-4000-8000-000000000001"\n');
  for (const file of assets) put(root, "attached_assets/" + file);
  const snapshot = root + "-snapshot";
  fs.cpSync(root, snapshot, { recursive: true });
  t.after(() => fs.rmSync(snapshot, { recursive: true, force: true }));
  return snapshot;
}

test("refuses cleanup in the working project even with explicit publish opt-in", t => {
  const root = fixture(t);
  assert.throws(() => prepareSnapshot({
    root,
    env: { ...nativeContext, REPLIT_DEV_DOMAIN: "workspace.replit.dev" },
    readHost: () => workspaceHost,
    mode: "apply",
  }), /working project/);
  assert.equal(fs.readFileSync(path.join(root, "generated-artifacts", "original.mp4"), "utf8"), "retain original");
});

test("prunes only the isolated copy and retains runtime dependencies, source and customer files", t => {
  const original = fixture(t);
  const copy = path.join(os.tmpdir(), path.basename(original) + "-copy");
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  fs.cpSync(original, copy, { recursive: true });
  const result = prepareSnapshot({
    root: copy, env: nativeContext, mode: "apply",
  });
  assert.equal(fs.existsSync(path.join(copy, "generated-artifacts")), false);
  for (const file of ["dist/index.cjs", "node_modules/helmet/package.json", "server/index.ts",
    "uploads/customer.pdf", "data/retained-report.md", "project-assets/customer-tool.html"]) {
    assert.ok(fs.existsSync(path.join(copy, file)), `${file} was retained`);
  }
  assert.equal(fs.readFileSync(path.join(original, "generated-artifacts/original.mp4"), "utf8"), "retain original");
  assert.ok(result.afterBytes < result.beforeBytes);
});

test("omits development copies and keeps every fixed runtime asset", t => {
  const root = fixture(t);
  const omitted = [
    ".git/objects/old", "public-mirror/archive", ".local/state/replit/session",
    ".local/aldon-assessment/report", ".local/private-oauth/state", ".local/testing-agent/capture",
    ".local/offline-verification/result", ".local/release-checks/check",
    ".local/company-deliverables/report.pdf", ".cache/uv/archive", ".cache/pip/archive",
    ".cache/nix/index", "project-assets/bwb-retrospective-delivery/movie.mp4",
    "data/private-alert-logs/alert", "attached_assets/unneeded-upload.mp4",
  ];
  for (const file of omitted) put(root, file);
  prepareSnapshot({ root, env: nativeContext, mode: "apply" });
  for (const file of omitted) assert.equal(fs.existsSync(path.join(root, file)), false, file);
  for (const file of assets) assert.ok(fs.existsSync(path.join(root, "attached_assets", file)), file);
});

test("rejects a symlinked ancestor before removing any file", t => {
  const root = fixture(t);
  const outside = fixture(t);
  put(outside, "state/replit/keep", "outside original");
  fs.rmSync(path.join(root, ".local"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(root, ".local"), "dir");
  assert.throws(() => prepareSnapshot({
    root, env: nativeContext, mode: "apply",
  }), /symlink/);
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
  assert.equal(fs.readFileSync(path.join(outside, "state/replit/keep"), "utf8"), "outside original");
});

test("refuses incomplete runtime output before pruning", t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, "dist/lib.es5.d.ts"));
  assert.throws(() => prepareSnapshot({
    root, env: nativeContext, mode: "apply",
  }), /runtime/);
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
});

test("blocks an oversized retained tree before any pruning", t => {
  const root = fixture(t);
  const fd = fs.openSync(path.join(root, "retained-large-file"), "w");
  fs.ftruncateSync(fd, 7 * 1024 ** 3);
  fs.closeSync(fd);
  assert.throws(() => prepareSnapshot({
    root, env: nativeContext, mode: "apply",
  }), /workspace budget/);
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
});

test("can estimate in the editor without mutating any files", t => {
  const root = fixture(t);
  const report = prepareSnapshot({ root, env: { REPLIT_DEV_DOMAIN: "editor.replit.dev" }, mode: "estimate" });
  assert.ok(report.projectedBytes < report.beforeBytes);
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
});

test("the real CLI fails closed in the editor and on unknown flags", t => {
  const root = fixture(t);
  const script = path.resolve(__dirname, "../../scripts/prepare-publish-snapshot.cjs");
  for (const arg of ["--apply", "--dry-run"]) {
    const result = spawnSync(process.execPath, ["--require", hostPreload(root, workspaceHost), script, arg], {
      cwd: root, encoding: "utf8",
      env: { PATH: process.env.PATH, ...nativeContext, REPLIT_DEV_DOMAIN: "editor.replit.dev" },
    });
    assert.equal(result.status, 1);
    assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
  }
});

test("the configured npm publish path builds in release mode before pruning its disposable copy", t => {
  const root = fixture(t);
  const original = fixture(t);
  const repository = path.resolve(__dirname, "../..");
  const configured = JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8")).scripts["build:publish"];
  fs.copyFileSync(path.join(repository, "scripts/prepare-publish-snapshot.cjs"),
    path.join(root, "scripts/prepare-publish-snapshot.cjs"));
  const boundaryModule = "scripts/lib/publish-workspace-boundary.cjs";
  if (fs.existsSync(path.join(repository, boundaryModule))) {
    put(root, boundaryModule, fs.readFileSync(path.join(repository, boundaryModule), "utf8"));
  }
  hostPreload(root, builderHost);
  put(root, "package.json", JSON.stringify({ private: true, scripts: {
    "build:publish": configured, build: "node fixture-build.cjs",
  } }));
  put(root, "fixture-build.cjs", `
    const fs=require("node:fs");
    if(!process.argv.includes("--release-check"))throw Error("Development export was not suppressed");
    fs.writeFileSync("dist/index.cjs","release-built fixture");
  `);
  const run = spawnSync("npm", ["run", "build:publish"], {
    cwd: root, encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, HOME: root, ...nativeContext,
      REPL_ID: "00000000-0000-4000-8000-000000000099",
      REPLIT_DEV_DOMAIN: "editor.replit.dev", REPLIT_DOMAINS: "EDITOR.REPLIT.DEV", NODE_ENV: "development",
      NODE_OPTIONS: `--require=${path.join(root, "fixture-host.cjs")}` },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(fs.readFileSync(path.join(root, "dist/index.cjs"), "utf8"), "release-built fixture");
  assert.equal(fs.existsSync(path.join(root, "generated-artifacts")), false);
  assert.ok(fs.existsSync(path.join(original, "generated-artifacts/original.mp4")));
});

test("missing opt-in and serving runtime still veto cleanup", t => {
  const contexts = [
    {}, { ...nativeContext, REPLIT_DEPLOYMENT: "1" },
  ];
  for (const env of contexts) {
    const root = fixture(t);
    assert.throws(() => prepareSnapshot({ root, env, mode: "apply" }));
    assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
  }
});

test("an isolated builder accepts inherited editor settings without treating them as workspace proof", t => {
  const root = fixture(t);
  const result = prepareSnapshot({
    root, mode: "apply", env: { ...nativeContext, REPLIT_DEV_DOMAIN: "editor.replit.dev",
      REPLIT_DOMAINS: "EDITOR.REPLIT.DEV", NODE_ENV: "development" },
  });
  assert.ok(result.afterBytes < result.beforeBytes);
  assert.equal(fs.existsSync(path.join(root, "generated-artifacts")), false);
});

test("a scrubbed local environment cannot authorize cleanup with only the opt-in flag", t => {
  const root = fixture(t);
  assert.throws(() => prepareSnapshot({
    root, env: { VISIONCLAW_PUBLISH_SNAPSHOT: "1" }, mode: "apply",
  }), /platform project identity/);
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
});

test("missing, unreadable or malformed original-project configuration never permits pruning", t => {
  const primary = "scripts/run-primary-only.sh";
  const cases = [
    root => ({ readHost: () => ({ ...builderHost, workspaceEditor: true }) }),
    root => ({ readHost: () => { throw new Error("proc unavailable"); } }),
    root => ({ readHost: () => ({ workspaceEditor: null }) }),
    root => { fs.unlinkSync(path.join(root, primary)); return {}; },
    root => { put(root, primary, "no original project configured"); return {}; },
    root => { put(root, primary, 'PRIMARY_REPL_ID="not-a-uuid"\n'); return {}; },
    root => {
      const outside = fixture(t);
      fs.unlinkSync(path.join(root, primary));
      fs.symlinkSync(path.join(outside, primary), path.join(root, primary));
      return {};
    },
  ];
  for (const change of cases) {
    const root = fixture(t);
    assert.throws(() => prepareSnapshot({ root, env: nativeContext, mode: "apply", ...change(root) }));
    assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
  }
});

test("a restarted original tree remains protected even while its editor is unavailable", t => {
  const root = fixture(t);
  assert.throws(() => prepareSnapshot({
    root, env: { ...nativeContext, REPL_ID: "00000000-0000-4000-8000-000000000001" },
    mode: "apply", readHost: () => builderHost,
  }), /original working project/);
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
});

test("a cleanup I/O failure is propagated rather than reported as successful packaging", t => {
  const root = fixture(t);
  const remove = fs.rmSync;
  fs.rmSync = function (target, ...rest) {
    if (target === path.join(root, "generated-artifacts")) throw new Error("simulated cleanup EACCES");
    return remove.call(this, target, ...rest);
  };
  try {
    assert.throws(() => prepareSnapshot({ root, env: nativeContext, mode: "apply" }), /simulated cleanup EACCES/);
  } finally {
    fs.rmSync = remove;
  }
  assert.ok(fs.existsSync(path.join(root, "generated-artifacts/original.mp4")));
});

test("a publishing copy accepts a build project ID different from the source workspace", t => {
  const root = fixture(t);
  const result = prepareSnapshot({
    root, mode: "apply", env: { ...nativeContext, REPL_ID: "00000000-0000-4000-8000-000000000099",
      REPLIT_DEV_DOMAIN: "editor.replit.dev", NODE_ENV: "production" },
  });
  assert.ok(result.afterBytes < result.beforeBytes);
});

test("publishing does not need a generated binding file", t => {
  const root = fixture(t);
  assert.equal(fs.existsSync(path.join(root, "scripts/publish-workspace-binding.json")), false);
  const result = prepareSnapshot({ root, env: nativeContext, mode: "apply" });
  assert.ok(result.afterBytes < result.beforeBytes);
});
