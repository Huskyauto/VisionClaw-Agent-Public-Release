"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { assertBuildBoundary } = require("./lib/publish-workspace-boundary.cjs");

// Exact development-only exclusions; never remove installed tools, runtime
// dependencies, source, uploads, or retained data indexes.
const OMIT = [
  ".git", "public-mirror", "generated-artifacts",
  ".local/state/replit", ".local/aldon-assessment", ".local/private-oauth",
  ".local/testing-agent", ".local/offline-verification", ".local/release-checks",
  ".local/company-deliverables", ".cache/uv", ".cache/pip", ".cache/nix",
  "project-assets/bwb-retrospective-delivery", "data/private-alert-logs",
];
const KEEP_ASSETS = new Set([
  "visionclaw-self-audit-2026-05-24.md", "visionclaw-self-audit-2026-05-24.pdf",
  "audit-pitch-bob.mp3", "Bob_on_Mounjaro_—_Channel_Avatar_1777847875921.png",
  "Vision_Claw_Logo_Final-01_1776037691274.png",
]);
const REQUIRED_SOURCE = ["package.json", ".replit", "scripts/build.ts"];
const REQUIRED_RUNTIME = [
  "dist/index.cjs", "dist/proposal-verifier-child.cjs", "dist/lib.es5.d.ts",
  "dist/copilot-chat-worker.mjs", "dist/legion/bin/tailscale", "dist/legion/bin/tailscaled",
  "node_modules/helmet/package.json",
];
// Reserve at least 2 GiB for the publisher's Nix/base layers. This is an
// admission budget, not a claim about the final provider-measured image size.
const WORKSPACE_BUDGET_BYTES = 6 * 1024 ** 3;

function requireFiles(root, files) {
  for (const file of files) {
    checkParents(root, file);
    if (!fs.existsSync(path.join(root, file)) || !fs.lstatSync(path.join(root, file)).isFile()) {
      throw new Error(`Required source/runtime file missing or not regular: ${file}`);
    }
  }
}

function bytes(target) {
  let stat;
  try { stat = fs.lstatSync(target); }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + bytes(path.join(target, name)), 0);
}

function checkParents(root, relative) {
  const parts = relative.split("/");
  // The leaf may be a link: rm unlinks it without traversing its target.
  for (let i = 1; i < parts.length; i++) {
    const parent = path.join(root, ...parts.slice(0, i));
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) throw new Error("Refusing a symlinked cleanup ancestor");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

function prepareSnapshot({ root = process.cwd(), env = process.env, mode = "check", readHost } = {}) {
  if (!["check", "apply", "estimate"].includes(mode)) throw new Error("Unknown snapshot mode");
  root = path.resolve(root);
  if (fs.realpathSync(root) !== root || root === path.parse(root).root) {
    throw new Error("Refusing a symlinked or filesystem cleanup root");
  }
  for (const relative of OMIT) checkParents(root, relative);
  if (mode !== "estimate") assertBuildBoundary({ root, env, readHost });
  if (fs.lstatSync(path.join(root, "attached_assets")).isSymbolicLink()) {
    throw new Error("Refusing a symlinked runtime asset directory");
  }
  requireFiles(root, REQUIRED_SOURCE);
  requireFiles(root, [...KEEP_ASSETS].map(name => "attached_assets/" + name));
  if (mode === "check") return { mode, readyToBuild: true };
  if (mode === "apply") requireFiles(root, REQUIRED_RUNTIME);
  const beforeBytes = bytes(root);
  const assets = path.join(root, "attached_assets");
  const removedAssets = fs.readdirSync(assets).filter(name => !KEEP_ASSETS.has(name));
  const excludedBytes = OMIT.reduce((sum, name) => sum + bytes(path.join(root, name)), 0)
    + removedAssets.reduce((sum, name) => sum + bytes(path.join(assets, name)), 0);
  const projectedBytes = beforeBytes - excludedBytes;
  if (mode === "apply" && projectedBytes > WORKSPACE_BUDGET_BYTES - 1024 * 1024) {
    throw new Error("Retained files exceed the 6 GiB workspace budget; no cleanup was applied");
  }
  if (mode === "apply") {
    for (const relative of OMIT) fs.rmSync(path.join(root, relative), { recursive: true, force: true });
    for (const name of removedAssets) fs.rmSync(path.join(assets, name), { recursive: true, force: true });
    requireFiles(root, [...REQUIRED_SOURCE, ...REQUIRED_RUNTIME,
      ...[...KEEP_ASSETS].map(name => "attached_assets/" + name)]);
  }
  const afterBytes = mode === "apply" ? bytes(root) : beforeBytes;
  if (mode === "apply" && afterBytes > WORKSPACE_BUDGET_BYTES) {
    throw new Error("Post-cleanup workspace budget exceeded; refusing publication");
  }
  return { mode, beforeBytes, projectedBytes, afterBytes, workspaceBudgetBytes: WORKSPACE_BUDGET_BYTES };
}

module.exports = { prepareSnapshot };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["--check", "--apply", "--estimate"].includes(args[0])) {
      throw new Error("Usage: node scripts/prepare-publish-snapshot.cjs --check|--apply|--estimate");
    }
    console.log(JSON.stringify(prepareSnapshot({ mode: args[0].slice(2) })));
  } catch (error) {
    console.error(`[publish-snapshot] ${error.message}`);
    process.exitCode = 1;
  }
}
