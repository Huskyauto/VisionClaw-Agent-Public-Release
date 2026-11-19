"use strict";
const fs = require("node:fs");
const path = require("node:path");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readWorkspaceEditor() {
  let workspaceEditor = false;
  let readable = 0;
  for (const pid of fs.readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    try {
      if (fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() === "nix-editor") workspaceEditor = true;
      readable++;
    } catch (error) {
      // A process can exit between listing and reading; all other errors veto cleanup.
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
  }
  if (!readable) throw new Error("Cannot establish workspace process context");
  return { workspaceEditor };
}

function validateHost(host) {
  if (!host || typeof host.workspaceEditor !== "boolean") {
    throw new Error("Cannot establish workspace editor status");
  }
}

function assertBuildBoundary({ root, env, readHost = readWorkspaceEditor }) {
  if (env.VISIONCLAW_PUBLISH_SNAPSHOT !== "1") {
    throw new Error("Publish snapshot cleanup requires explicit publisher opt-in");
  }
  if (env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Refusing snapshot cleanup in the serving production runtime");
  }
  if (typeof env.REPL_ID !== "string" || !UUID.test(env.REPL_ID)) {
    throw new Error("Publish cleanup requires a platform project identity");
  }
  // Reuse the existing original-project setting. A temporary publishing copy
  // must NOT be required to have the original workspace's managed identity.
  const primaryFile = path.join(root, "scripts/run-primary-only.sh");
  if (fs.realpathSync(primaryFile) !== primaryFile || !fs.lstatSync(primaryFile).isFile()
      || fs.lstatSync(primaryFile).size > 8192) {
    throw new Error("Invalid original-project configuration");
  }
  const matches = [...fs.readFileSync(primaryFile, "utf8").matchAll(/^PRIMARY_REPL_ID="([^"\r\n]+)"\r?$/gm)];
  if (matches.length !== 1 || !UUID.test(matches[0][1])) {
    throw new Error("Invalid original-project configuration");
  }
  if (env.REPL_ID.toLowerCase() === matches[0][1].toLowerCase()) {
    throw new Error("Refusing snapshot cleanup in the original working project");
  }
  const host = readHost();
  validateHost(host);
  if (host.workspaceEditor) throw new Error("Refusing snapshot cleanup in the working project (live editor)");
}

module.exports = { assertBuildBoundary };
