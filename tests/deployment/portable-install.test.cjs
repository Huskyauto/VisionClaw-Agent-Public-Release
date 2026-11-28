// Runs with Node alone, before npm ci, including on external builders.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const root = resolve(__dirname, "../..");

test("every locked tarball is downloadable from the public HTTPS npm registry", () => {
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const invalid = [];
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue;
    const url = new URL(entry.resolved);
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org"
        || url.username || url.password || !entry.integrity) invalid.push(name);
  }
  assert.deepEqual(invalid, [], "Nonportable or integrity-free package downloads");
});

test("private mirror preserves remote ancestry and refuses force pushes", {
  skip: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).private !== true,
}, () => {
  const script = readFileSync(resolve(root, "scripts/build-public-mirror.sh"), "utf8");
  assert.match(script, /fetch --no-tags public main/);
  const parent = script.indexOf("git reset --soft FETCH_HEAD");
  assert.ok(parent > script.indexOf("git init -q -b main"));
  assert.ok(parent < script.indexOf("git add -A"));
  assert.doesNotMatch(script, /\bpush\s+(?:-f\b|--force(?:-with-lease)?\b)/);
});

test("CI uses verified Docker Hub cache copies without changing default images", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
  const postgres = "mirror.gcr.io/pgvector/pgvector:pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a";
  const node = "mirror.gcr.io/library/node:22.22.0-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94";
  assert.equal(workflow.split(`image: ${postgres}`).length - 1, 2);
  assert.ok(workflow.includes(`--build-arg NODE_IMAGE=${node}`));
  assert.ok(dockerfile.includes("ARG NODE_IMAGE=node:22.22.0-slim"));
  assert.equal(dockerfile.split("FROM ${NODE_IMAGE} AS ").length - 1, 2);
  // The early container layer contains only the package files and this test.
  // Run the registry check there, not workspace-only publisher/CI contracts.
  assert.ok(dockerfile.includes('--test-name-pattern="^every locked tarball"'));
});

test("Docker smoke frees only unused hosted-runner SDKs before building and retains its health gate", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const docker = workflow.split("\n  docker:\n")[1]?.split(/\n  [a-zA-Z0-9_-]+:\n/)[0];
  assert.ok(docker, "Docker hard gate must remain present");
  const cleanup = docker.indexOf("- name: Free unused hosted-runner SDK disk space");
  const build = docker.indexOf("- name: Build container image");
  const health = docker.indexOf("- name: Boot container and probe /healthz");
  assert.ok(cleanup >= 0 && cleanup < build && build < health,
    "reclaim disk before the real image build without removing either smoke step");
  const body = docker.slice(cleanup, build).split("run: |")[1].trim();
  assert.deepEqual(body.split("\n").map(line => line.trim()).filter(Boolean), [
    "df -h /",
    "sudo rm -rf -- /usr/local/lib/android /usr/share/dotnet /opt/hostedtoolcache/CodeQL",
    "df -h /",
  ], "cleanup is an explicit SDK-only allowlist, not Docker, workspace or database pruning");
  assert.doesNotMatch(docker, /continue-on-error:\s*true/);
});
