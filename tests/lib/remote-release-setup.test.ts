import { test } from "node:test";
import assert from "node:assert/strict";
import { SETUP_FILES, uploadSetup } from "../../scripts/lib/remote-release-setup";
import { blobHash } from "../../scripts/lib/remote-release-candidate";
import { REMOTE_RELEASE_WORKFLOW } from "../../scripts/lib/remote-release-contract";
import { setupSnapshot } from "../../scripts/lib/remote-release-setup";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("setup rejects a symlinked parent before reading outside source bytes", () => {
  const original = process.cwd();
  const root = mkdtempSync(path.join(tmpdir(), "setup-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "setup-outside-"));
  try {
    writeFileSync(path.join(outside, "security-checks.yml"), "name: fixture\n");
    mkdirSync(path.join(root, ".github"));
    symlinkSync(outside, path.join(root, ".github/workflows"));
    process.chdir(root);
    assert.throws(() => setupSnapshot(), /Unsafe setup source root/);
  } finally { process.chdir(original); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("setup copies only explicit code paths and creates one isolated ref", async () => {
  const calls: { route: string; init?: RequestInit }[] = [];
  let uploaded: any[] = [];
  const request = async (route: string, init?: RequestInit) => {
    calls.push({ route, init });
    let value: unknown;
    const method = init?.method ?? "GET";
    if (method === "GET" && route.endsWith("/VisionClaw-Agent")) value = { id: 10, private: true, default_branch: "main" };
    else if (route.endsWith("/branches/main")) value = { commit: { sha: "a".repeat(40) } };
    else if (route.endsWith("/actions/workflows/security-checks.yml")) value = { id: 20, path: REMOTE_RELEASE_WORKFLOW, state: "active" };
    else if (route.includes("/git/ref/heads/release-checks/")) return new Response("{}", { status: 404 });
    else if (method === "GET" && route.includes("/git/commits/")) value = { tree: { sha: "c".repeat(40) } };
    else if (method === "POST" && route.endsWith("/git/trees")) {
      const body = JSON.parse(String(init?.body)); uploaded = body.tree;
      assert.equal(body.base_tree, "c".repeat(40));
      value = { sha: "d".repeat(40) };
    } else if (method === "POST" && route.endsWith("/git/commits")) {
      assert.deepEqual(JSON.parse(String(init?.body)).parents, ["a".repeat(40)]);
      value = { sha: "b".repeat(40) };
    } else if (method === "POST" && route.endsWith("/git/refs")) {
      assert.match(JSON.parse(String(init?.body)).ref, /^refs\/heads\/release-checks\/[a-f0-9]{64}$/);
      value = { object: { sha: "b".repeat(40) } };
    } else if (method === "GET" && route.includes("/git/trees/")) {
      value = { truncated: false, tree: uploaded.map(f => ({
        path: f.path, mode: f.mode, sha: blobHash(Buffer.from(f.content)), type: "blob",
      })) };
    } else assert.fail(`Unexpected setup request ${method} ${route}`);
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const result = await uploadSetup(request, true);
  assert.equal(result.purpose, "setup-proof-not-release-clearance");
  assert.deepEqual(uploaded.map(f => f.path), SETUP_FILES);
  assert.ok(uploaded.every(f => !/^(?:data|uploads|attached_assets|\.agents)\//.test(f.path)));
  assert.equal(calls.filter(c => c.init?.method === "POST" && c.route.endsWith("/git/refs")).length, 1);
  assert.ok(calls.findIndex(c => c.route.includes("/git/trees/") && c.init?.method === "GET") <
    calls.findIndex(c => c.route.endsWith("/git/refs") && c.init?.method === "POST"));
  assert.ok(calls.every(c => c.init?.method !== "PATCH" && c.init?.method !== "PUT"));
  await assert.rejects(uploadSetup(request, false), /Owner approval/);
});
