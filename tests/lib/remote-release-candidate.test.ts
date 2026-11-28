import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { digestReleaseInputs } from "../../scripts/lib/targeted-release-check";
import { REMOTE_RELEASE_REPO } from "../../scripts/lib/remote-release-contract";
import { assertUploadSafe, blobHash, candidateSnapshotIdentity, readCandidate, uploadCandidate, type CandidateFile, type GitHubRequest } from "../../scripts/lib/remote-release-candidate";

const BASE = "1".repeat(40);
const TREE = "2".repeat(40);
const TREE_CREATED = "3".repeat(40);
const COMMIT_CREATED = "4".repeat(40);

function candidate(files: CandidateFile[]) {
  return {
    files,
    sourceDigest: digestReleaseInputs(files.map(file => ({
      path: file.path, content: file.bytes.toString("base64"),
    }))),
  };
}

function fakeGitHub(options: {
  tree?: { path: string; sha: string; mode: string; type: string }[];
  beforeRepo?: () => Promise<void>;
  corruptSavedTree?: boolean;
} = {}) {
  const calls: { route: string; method: string; body?: any }[] = [];
  let savedTree: any[] = [];
  const request: GitHubRequest = async (route, init = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ route, method, body });
    if (route === `/repos/${REMOTE_RELEASE_REPO}`) {
      await options.beforeRepo?.();
      return Response.json({ id: 101, private: true, default_branch: "main" });
    }
    if (route.endsWith("/git/ref/heads/main"))
      return Response.json({ object: { sha: BASE } });
    if (route.endsWith(`/git/commits/${BASE}`))
      return Response.json({ tree: { sha: TREE } });
    if (route.endsWith(`/git/trees/${TREE}?recursive=1`))
      return Response.json({ truncated: false, tree: options.tree ?? [] });
    if (route.endsWith(`/git/trees/${TREE_CREATED}?recursive=1`))
      return Response.json({ truncated: false, tree: options.corruptSavedTree
        ? savedTree.map(item => ({ ...item, sha: "f".repeat(40) })) : savedTree });
    if (route.includes("/git/ref/heads/release-checks/"))
      return new Response("", { status: 404 });
    if (route.endsWith("/git/blobs"))
      return Response.json({ sha: blobHash(Buffer.from(body.content, "base64")) });
    if (route.endsWith("/git/trees")) {
      const items = new Map((options.tree ?? []).map(item => [item.path, item]));
      for (const item of body.tree) {
        if (item.sha === null) items.delete(item.path);
        else items.set(item.path, { path: item.path, type: "blob", mode: item.mode,
          sha: item.content === undefined ? item.sha : blobHash(Buffer.from(item.content)) });
      }
      savedTree = [...items.values()];
      return Response.json({ sha: TREE_CREATED });
    }
    if (route.endsWith("/git/commits"))
      return Response.json({ sha: COMMIT_CREATED });
    if (route.endsWith("/git/refs"))
      return Response.json({ ref: body.ref });
    return new Response("", { status: 404 });
  };
  return { request, calls };
}

const writes = (calls: ReturnType<typeof fakeGitHub>["calls"]) =>
  calls.filter(call => call.method !== "GET");

test("accepts fully redacted URL userinfo without permitting a visible username token", () => {
  for (const value of ["https://***@github.com/example/repo", "https://[REDACTED]:***@api.example.org"]) {
    assert.doesNotThrow(() => assertUploadSafe({
      path: "scripts/remote-release.ts", bytes: Buffer.from(value), mode: "100644",
    }));
  }
  const value = ["https:/", "/liveCredentialStillVisible", "@github.com/example/repo"].join("");
  assert.throws(() => assertUploadSafe({
    path: "scripts/remote-release.ts", bytes: Buffer.from(value), mode: "100644",
  }), /Potential credential/);
});

test("an environment placeholder never exempts the other visible credential component", () => {
  for (const userinfo of [
    ["liveCredentialStillVisible", ":", "${DATABASE_PASSWORD}"].join(""),
    ["${DATABASE_USERNAME}", ":", "livePasswordStillVisible"].join(""),
  ]) {
    const value = ["https:/", "/", userinfo, "@api.production.acme.io"].join("");
    assert.throws(() => assertUploadSafe({
      path: "scripts/remote-release.ts", bytes: Buffer.from(value), mode: "100644",
    }), /Potential credential/);
  }
});

test("snapshot freshness detects mode-only changes without changing content identity", () => {
  const item = candidate([{ path: "package.json", bytes: Buffer.from("{}"), mode: "100644" }]);
  const before = candidateSnapshotIdentity(item);
  item.files[0].mode = "100755";
  assert.notEqual(candidateSnapshotIdentity(item), before);
  assert.equal(candidate(item.files).sourceDigest, item.sourceDigest);
});

test("initial upload tree inventory uses the bounded metadata reader before writes", async () => {
  const fake = fakeGitHub();
  const request: GitHubRequest = (route, init) => route.endsWith(`/git/trees/${TREE}?recursive=1`)
    ? Promise.resolve(Response.json({ truncated: false, tree: [], padding: "x".repeat(8 * 1024 * 1024) }))
    : fake.request(route, init);
  await assert.rejects(uploadCandidate(request, candidate([{
    path: "package.json", bytes: Buffer.from("{}"), mode: "100644",
  }]), true), /bounded size/);
  assert.equal(writes(fake.calls).length, 0);
});

test("rejects a forged source digest before making any GitHub request", async () => {
  const item = candidate([{ path: "src/a.ts", bytes: Buffer.from("original"), mode: "100644" }]);
  item.sourceDigest = "a".repeat(64);
  const fake = fakeGitHub();
  await assert.rejects(uploadCandidate(fake.request, item, true), /digest/);
  assert.equal(fake.calls.length, 0);
});

test("rejects duplicate, empty and non-normalized membership before requests", async () => {
  for (const files of [
    [
      { path: "src/a.ts", bytes: Buffer.from("a"), mode: "100644" as const },
      { path: "src/a.ts", bytes: Buffer.from("b"), mode: "100644" as const },
    ],
    [{ path: "", bytes: Buffer.from("a"), mode: "100644" as const }],
    [{ path: "src//a.ts", bytes: Buffer.from("a"), mode: "100644" as const }],
  ]) {
    const fake = fakeGitHub();
    await assert.rejects(uploadCandidate(fake.request, candidate(files), true));
    assert.equal(fake.calls.length, 0);
  }
});

test("deep-copies candidate bytes before awaiting transport and uploads the captured snapshot", async () => {
  let releaseFirstRequest!: () => void;
  const waiting = new Promise<void>(resolve => { releaseFirstRequest = resolve; });
  const bytes = Buffer.from([0xff, 0x00, 0x7f]);
  const original = Buffer.from(bytes);
  const inputFile: CandidateFile = { path: "scripts/lib/glm54-checkout.png", bytes, mode: "100644" };
  const item = candidate([inputFile]);
  const fake = fakeGitHub({ beforeRepo: () => waiting });
  const pending = uploadCandidate(fake.request, item, true);
  await Promise.resolve();
  bytes.fill(0);
  inputFile.path = "secrets/changed.bin";
  inputFile.mode = "100755";
  releaseFirstRequest();
  await pending;
  const blobWrite = fake.calls.find(call => call.route.endsWith("/git/blobs"));
  assert.equal(blobWrite?.body.content, original.toString("base64"));
  const treeWrite = fake.calls.find(call => call.route.endsWith("/git/trees"));
  assert.equal(treeWrite?.body.tree[0].path, "scripts/lib/glm54-checkout.png");
  assert.equal(treeWrite?.body.tree[0].mode, "100644");
});

test("rejects private upload, backup and token namespaces while allowing project documentation", async () => {
  const blocked = [
    "uploads/customer.csv", "attached_assets/customer.bin", "backups/db.sql",
    "private/tokens/session.json", "secrets/provider.txt", "token-store/current.json",
  ];
  for (const path of blocked) {
    const fake = fakeGitHub();
    const item = candidate([{ path, bytes: Buffer.from("not a secret"), mode: "100644" }]);
    await assert.rejects(uploadCandidate(fake.request, item, true), /Private\/non-source/);
    assert.equal(fake.calls.some(call => call.method === "POST"), false, path);
  }
  for (const path of [
    ".agents/memory/review.md",
    "project-assets/customer-revenue-launchpad/offers/06-hvac-invoice-processing-pilot.md",
    ".env.example",
  ]) {
    const fake = fakeGitHub();
    const item = candidate([{ path, bytes: Buffer.from("ordinary documentation"), mode: "100644" }]);
    await uploadCandidate(fake.request, item, true);
  }
});

test("rejects real-looking provider, live-payment and embedded-URL credentials without echoing values", async () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const key = (length: number) => alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length);
  const markers = [
    `sk-ant-api03-${key(64)}`,
    `sk-proj-${key(64)}`,
    `sk-svcacct-${key(64)}`,
    `sk-${key(48)}`,
    `sk_live_${key(32)}`,
    ["postgres:/", "/operator", ":", "very-secret-password@db.production.acme.io/app"].join(""),
  ];
  for (const marker of markers) {
    const fake = fakeGitHub();
    const item = candidate([{ path: "scripts/targeted-release-check.ts", bytes: Buffer.from(marker), mode: "100644" }]);
    await assert.rejects(uploadCandidate(fake.request, item, true), (error: any) => {
      assert.match(error.message, /Potential credential/);
      assert.ok(!error.message.includes(marker));
      return true;
    });
    assert.equal(fake.calls.some(call => call.method === "POST"), false);
  }
});

test("allows synthetic localhost, loopback and reserved-domain database URLs and descriptive key placeholders", () => {
  const fixtures = [
    "postgres://postgres:postgres@127.0.0.1:5432/visionclaw_remote",
    "postgresql://offline:offline@localhost:5432/offline",
    "postgres://offline:offline@[::1]:5432/offline",
    "https://user:pass@api.invalid/path",
    "https://user:pass@docs.example.com/path",
    ["https://operator:", "${DATABASE_PASSWORD}@db.production.acme.io/app"].join(""),
    "sk-proj-example-placeholder-not-a-real-key",
    "sk-svcacct-example-placeholder",
    "sk_live_example-placeholder",
    "sk-ant-api03-not-a-real-key",
  ];
  for (const content of fixtures) {
    assert.doesNotThrow(() => assertUploadSafe({
      path: "tests/fixtures/offline-example.txt",
      bytes: Buffer.from(content),
      mode: "100644",
    }));
  }
});

test("unchanged token-looking remote fixture is not rescanned or uploaded as a blob", async () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = Buffer.from(`sk-proj-${alphabet.repeat(2).slice(0, 64)}`);
  const path = "tests/fixtures/route-census.json";
  assert.throws(() => assertUploadSafe({ path, bytes, mode: "100644" }), /Potential credential/);
  const fake = fakeGitHub({ tree: [{
    path, sha: blobHash(bytes), mode: "100644", type: "blob",
  }] });
  await uploadCandidate(fake.request, candidate([{ path, bytes, mode: "100644" }]), true);
  assert.equal(fake.calls.filter(call => call.route.endsWith("/git/blobs")).length, 0);
  const treeWrite = fake.calls.find(call => call.method === "POST" && call.route.endsWith("/git/trees"));
  assert.deepEqual(treeWrite?.body.tree, []);
});

test("changed credential markers are rejected before any POST", async () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const key = alphabet.repeat(2).slice(0, 64);
  const fake = fakeGitHub();
  await assert.rejects(uploadCandidate(fake.request, candidate([{
    path: "scripts/targeted-release-check.ts",
    bytes: Buffer.from(`const key = "sk-proj-${key}";`),
    mode: "100644",
  }]), true), /Potential credential/);
  assert.equal(fake.calls.some(call => call.method === "POST"), false);
});

test("unclassified changed paths fail with baseline review guidance before any POST", async () => {
  const fake = fakeGitHub();
  await assert.rejects(uploadCandidate(fake.request, candidate([{
    path: "scripts/unclassified-check.ts", bytes: Buffer.from("ordinary source"), mode: "100644",
  }]), true), /unclassified paths; baseline\/scope needs review/);
  assert.equal(fake.calls.some(call => call.method === "POST"), false);
});

test("rejects executable-mode changes and new executable entries before write requests", async () => {
  const sameBytes = Buffer.from("#!/bin/sh\ntrue\n");
  const existing = fakeGitHub({ tree: [{
    path: "scripts/build.ts",
    sha: blobHash(sameBytes),
    mode: "100644", type: "blob",
  }] });
  await assert.rejects(uploadCandidate(existing.request,
    candidate([{ path: "scripts/build.ts", bytes: sameBytes, mode: "100755" }]), true), /mode change/);
  assert.equal(writes(existing.calls).length, 0);

  const fresh = fakeGitHub();
  await assert.rejects(uploadCandidate(fresh.request,
    candidate([{ path: "scripts/build.ts", bytes: sameBytes, mode: "100755" }]), true), /New candidate files must use mode 100644/);
  assert.equal(writes(fresh.calls).length, 0);
});

test("computes the aggregate write-payload budget before creating any remote blobs", async () => {
  const largeBinary = Buffer.alloc(9 * 1024 * 1024, 0xff);
  const fake = fakeGitHub();
  await assert.rejects(uploadCandidate(fake.request,
    candidate([{ path: "scripts/lib/glm54-checkout.png", bytes: largeBinary, mode: "100644" }]), true), /upload budget/);
  assert.equal(writes(fake.calls).length, 0);
});

test("offloads large text blobs before creating a bounded Git tree request", async () => {
  const fake = fakeGitHub();
  const bytes = Buffer.alloc(5 * 1024 * 1024, "a");
  await uploadCandidate(fake.request, candidate([{ path: "package.json", bytes, mode: "100644" }]), true);
  const tree = fake.calls.find(call => call.method === "POST" && call.route.endsWith("/git/trees"));
  assert.ok(Buffer.byteLength(JSON.stringify(tree?.body)) <= 4 * 1024 * 1024);
  assert.equal(fake.calls.filter(call => call.method === "POST" && call.route.endsWith("/git/blobs")).length, 1);
});

test("verifies stored source bytes before making a candidate branch reachable", async () => {
  const fake = fakeGitHub({ corruptSavedTree: true });
  await assert.rejects(uploadCandidate(fake.request, candidate([{
    path: "package.json", bytes: Buffer.from("{}"), mode: "100644",
  }]), true), /bytes|mode/i);
  assert.equal(fake.calls.filter(call => call.method === "POST" && call.route.endsWith("/git/refs")).length, 0);
});

test("creates only the digest-named release-checks ref, never a main update", async () => {
  const item = candidate([{ path: ".agents/memory/remote-release-review.md", bytes: Buffer.from("test"), mode: "100644" }]);
  const fake = fakeGitHub();
  const result = await uploadCandidate(fake.request, item, true);
  assert.equal(result.branch, `release-checks/${item.sourceDigest}`);
  const refWrites = fake.calls.filter(call => call.route.endsWith("/git/refs"));
  assert.equal(refWrites.length, 1);
  assert.equal(refWrites[0].body.ref, `refs/heads/release-checks/${item.sourceDigest}`);
  assert.ok(fake.calls.every(call => call.method === "GET" || !call.route.endsWith("/git/refs") || call.body.ref !== "refs/heads/main"));
});

test("missing tracked files fail with an explicit staged-deletion instruction", () => {
  const root = mkdtempSync(path.join(tmpdir(), "remote-candidate-delete-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(path.join(root, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: root });
    rmSync(path.join(root, "tracked.txt"));
    assert.throws(() => readCandidate(root), /Missing candidate source path; stage deletions before upload: tracked\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
