import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectorTransport, reconcile, reusableCollectedReport } from "../../scripts/remote-release";
import { blobHash, readCandidate } from "../../scripts/lib/remote-release-candidate";
import { REMOTE_RELEASE_REPO, REMOTE_RELEASE_WORKFLOW } from "../../scripts/lib/remote-release-contract";

test("reauthentication reuses reviewed report bytes and rejects altered receipts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "collected-evidence-"));
  const relative = ".local/release-checks/run-abc123/report.json";
  const report = { createdAt: "old", source: { digest: "a".repeat(64) },
    remote: { trusted: { runId: 17, runAttempt: 1 } } };
  const files = new Map([["typecheck.log", Buffer.from("verified log")]]);
  try {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), JSON.stringify(report));
    writeFileSync(path.join(root, path.dirname(relative), "typecheck.log"), "verified log");
    assert.equal(reusableCollectedReport(root, relative, { ...report, createdAt: "new" }, files), relative);
    assert.equal(reusableCollectedReport(root, relative, { ...report,
      remote: { trusted: { runId: 17, runAttempt: 2 } } }, files), undefined);
    writeFileSync(path.join(root, path.dirname(relative), "typecheck.log"), "tampered");
    assert.throws(() => reusableCollectedReport(root, relative, report, files), /differs/);
    assert.throws(() => reusableCollectedReport(root, "../outside.json", report, files), /Unsafe/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("refuses arbitrary redirects before any external request", async () => {
  const transport = connectorTransport(async () => new Response(null, {
    status: 302, headers: { location: "https://127.0.0.1/private" },
  }));
  await assert.rejects(transport(`/repos/${REMOTE_RELEASE_REPO}/actions/artifacts/3/zip`, { method: "GET" }),
    /Untrusted artifact/);
  await assert.rejects(transport(`/repos/${REMOTE_RELEASE_REPO}/git/refs`, { method: "POST" }),
    /Unexpected GitHub redirect/);
  await assert.rejects(transport("/repos/another/project"), /Unexpected GitHub request/);
});

test("reconciles exact source after an uncertain upload with GET requests only", async () => {
  const original = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), "remote-operator-test-"));
  try {
    execFileSync("git", ["init", "-q", dir], { stdio: "pipe" });
    process.chdir(dir);
    writeFileSync("package.json", "{}\n");
    const candidate = readCandidate();
    const branch = `release-checks/${candidate.sourceDigest}`;
    const base = "a".repeat(40), head = "b".repeat(40), tree = "d".repeat(40);
    const calls: string[] = [];
    const state = { version: 1 as const, phase: "upload_uncertain", sourceDigest: candidate.sourceDigest,
      createdAt: "2026-11-26T00:00:00.000Z" };
    const request = async (route: string, init?: RequestInit) => {
      assert.equal(init?.method ?? "GET", "GET"); calls.push(route);
      let result: unknown;
      if (route.endsWith(`/repos/${REMOTE_RELEASE_REPO}`)) result = { private: true, default_branch: "main", id: 10 };
      else if (route.endsWith("/branches/main")) result = { commit: { sha: base } };
      else if (route.endsWith("/actions/workflows/security-checks.yml"))
        result = { id: 20, path: REMOTE_RELEASE_WORKFLOW, state: "active" };
      else if (route.endsWith(`/git/ref/heads/${branch}`)) result = { object: { sha: head } };
      else if (route.endsWith(`/git/commits/${base}`)) result = { tree: { sha: "e".repeat(40) } };
      else if (route.includes(`/git/trees/${"e".repeat(40)}`)) result = { truncated: false, tree: [] };
      else if (route.endsWith(`/git/commits/${head}`)) result = { parents: [{ sha: base }], tree: { sha: tree } };
      else if (route.includes(`/git/trees/${tree}`)) result = { truncated: false, tree: [
        { path: "package.json", type: "blob", mode: "100644", sha: blobHash(Buffer.from("{}\n")) },
      ] };
      else assert.fail(`Unexpected route ${route}`);
      return new Response(JSON.stringify(result), { status: 200 });
    };
    const recovered = await reconcile(state, request);
    assert.equal(recovered.phase, "uploaded");
    assert.equal(recovered.head, head);
    assert.equal(recovered.plan?.sourceDigest, candidate.sourceDigest);
    assert.ok(calls.length >= 7);
    await assert.rejects(reconcile({ ...state, sourceDigest: "0".repeat(64) }, request), /source changed/);
  } finally {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  }
});
