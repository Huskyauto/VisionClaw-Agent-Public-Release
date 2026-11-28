import { readFileSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { assertUploadSafe, blobHash, type GitHubRequest, type CandidateFile } from "./remote-release-candidate";
import { digestReleaseInputs } from "./targeted-release-check";
import { REMOTE_RELEASE_REPO } from "./remote-release-contract";
import { createRemoteGitHubClient } from "./remote-release-github";

/** Explicit code-only setup list; never copies unrelated pending app/data changes. */
export const SETUP_FILES = [
  ".github/workflows/security-checks.yml", "package.json", "package-lock.json",
  "scripts/remote-release.ts", "scripts/remote-release-worker.ts", "scripts/remote-release-setup-worker.ts",
  "scripts/lib/remote-release-contract.ts", "scripts/lib/remote-release-plan.ts",
  "scripts/lib/remote-release-verifier.ts", "scripts/lib/remote-release-github.ts",
  "scripts/lib/remote-release-candidate.ts", "scripts/lib/remote-release-evidence.ts",
  "scripts/lib/remote-release-tree.ts",
  "scripts/lib/remote-release-renew.ts",
  "scripts/lib/remote-release-setup.ts", "scripts/lib/targeted-release-check.ts",
  "scripts/lib/bwb-verification-profile.ts", "scripts/lib/republish-incremental-readiness.ts",
  "scripts/lib/tenant-audit-evidence-hash.ts", "scripts/lib/offline-verification.ts",
  "scripts/lib/release-runtime-artifacts.ts",
  "scripts/prepublish.ts", "scripts/lib/prepublish-remote-gate.ts",
  "scripts/publish-preflight.ts", "tsconfig.publish-preflight.json",
  "server/safety/spawn-env-guard.ts",
  "tests/lib/remote-release-worker.test.ts", "tests/lib/remote-release-verifier.test.ts",
  "tests/lib/remote-release-github.test.ts", "tests/lib/remote-release-candidate.test.ts",
  "tests/lib/remote-release-evidence.test.ts", "tests/lib/remote-release-operator.test.ts",
  "tests/lib/remote-release-setup.test.ts",
  "tests/lib/prepublish-remote-gate.test.ts",
  "tests/lib/remote-release-tree.test.ts",
  "tests/lib/remote-release-renew.test.ts",
  "tests/lib/release-runtime-artifacts.test.ts",
].sort();

export function setupSnapshot() {
  const files: CandidateFile[] = SETUP_FILES.map(file => {
    const full = path.resolve(file);
    if (realpathSync(full) !== full) throw Error("Unsafe setup source root");
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      throw Error("Unsafe setup source file");
    const result: CandidateFile = { path: file, bytes: readFileSync(file), mode: "100644" };
    assertUploadSafe(result);
    return result;
  });
  return { files, digest: digestReleaseInputs(files.map(f => ({ path: f.path, content: f.bytes.toString("base64") }))) };
}

export async function uploadSetup(request: GitHubRequest, approved: boolean) {
  if (approved !== true) throw Error("Owner approval required for test-only setup upload");
  const snapshot = setupSnapshot();
  const client = createRemoteGitHubClient(request);
  const meta = await client.metadata();
  const api = `/repos/${REMOTE_RELEASE_REPO}`;
  const get = async (route: string) => {
    const response = await request(api + route, { method: "GET" });
    if (!response.ok) throw Error(`Setup inspection failed (${response.status})`);
    return response.json();
  };
  const branch = `release-checks/${snapshot.digest}`;
  const previous = await request(`${api}/git/ref/heads/${branch}`, { method: "GET" });
  if (previous.status !== 404) throw Error("Setup branch exists or cannot be inspected; do not duplicate it");
  const commit = await get(`/git/commits/${meta.mainSha}`);
  if (!/^[a-f0-9]{40}$/.test(commit.tree?.sha)) throw Error("Invalid setup base tree");
  const tree = snapshot.files.map(file => {
    const text = file.bytes.toString("utf8");
    if (!Buffer.from(text).equals(file.bytes)) throw Error("Setup upload accepts reviewed text code only");
    return { path: file.path, mode: file.mode, type: "blob", content: text };
  });
  if (Buffer.byteLength(JSON.stringify(tree)) > 4 * 1024 * 1024) throw Error("Setup delta exceeds 4 MiB");
  const post = async (route: string, body: unknown) => {
    const r = await request(api + route, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body) });
    if (!r.ok) throw Error(`Setup write returned ${r.status}; inspect before retrying`);
    return r.status === 204 ? null : r.json();
  };
  const createdTree = await post("/git/trees", { base_tree: commit.tree.sha, tree });
  if (!/^[a-f0-9]{40}$/.test(createdTree?.sha)) throw Error("Invalid setup tree");
  const created = await post("/git/commits", {
    tree: createdTree.sha, parents: [meta.mainSha], message: "Test-only GitHub release-check setup proof",
  });
  if (!/^[a-f0-9]{40}$/.test(created?.sha)) throw Error("Invalid setup commit");
  // Verify the API-stored bytes before making the commit reachable as a branch.
  const saved = await get(`/git/trees/${createdTree.sha}?recursive=1`);
  if (saved.truncated || !Array.isArray(saved.tree)) throw Error("Incomplete setup tree receipt");
  const entries = new Map(saved.tree.map((f: any) => [f.path, f]));
  for (const file of snapshot.files) {
    const remote: any = entries.get(file.path);
    if (remote?.sha !== blobHash(file.bytes) || remote.mode !== file.mode) throw Error("Setup source bytes were not preserved");
  }
  await post("/git/refs", { ref: `refs/heads/${branch}`, sha: created.sha });
  return { version: 1, purpose: "setup-proof-not-release-clearance", digest: snapshot.digest,
    branch, head: created.sha as string, ...meta, files: SETUP_FILES };
}
