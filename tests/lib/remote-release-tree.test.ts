import test from "node:test";
import assert from "node:assert/strict";
import { changedRepositoryPaths, readRepositoryTree, verifyCandidateTree } from "../../scripts/lib/remote-release-tree";
import { blobHash, type GitHubRequest } from "../../scripts/lib/remote-release-candidate";

const base = "1".repeat(40), head = "2".repeat(40);
const baseTree = "3".repeat(40), headTree = "4".repeat(40);
const entry = (path: string, sha = "5".repeat(40), mode = "100644") => ({ path, sha, mode, type: "blob" });
function transport(before: any[], after: any[], truncated = false): GitHubRequest {
  return async route => {
    if (route.endsWith(`/git/commits/${base}`)) return Response.json({ tree: { sha: baseTree } });
    if (route.endsWith(`/git/commits/${head}`)) return Response.json({ tree: { sha: headTree } });
    if (route.includes(`/git/trees/${baseTree}?`)) return Response.json({ tree: before, truncated });
    if (route.includes(`/git/trees/${headTree}?`)) return Response.json({ tree: after, truncated });
    return new Response(null, { status: 404 });
  };
}

test("compares complete Git trees beyond the 300-file compare-API limit", async () => {
  const paths = Array.from({ length: 401 }, (_, i) => `docs/changed-${i}.md`).sort();
  assert.deepEqual(await changedRepositoryPaths(transport([], paths.map(p => entry(p))), base, head), paths);
});

test("tree comparison includes deletions, rename identities and mode changes", async () => {
  const before = [entry("old.ts"), entry("mode.sh")];
  const after = [entry("new.ts"), entry("mode.sh", "5".repeat(40), "100755")];
  assert.deepEqual(await changedRepositoryPaths(transport(before, after), base, head), ["mode.sh", "new.ts", "old.ts"]);
});

test("refuses truncated, duplicate and unsafe tree membership", async () => {
  await assert.rejects(readRepositoryTree(transport([], [], true), head), /incomplete/i);
  await assert.rejects(readRepositoryTree(transport([], [entry("a"), entry("a")]), head), /duplicate/i);
  await assert.rejects(readRepositoryTree(transport([], [entry("../escape")]), head), /unsafe/i);
});

test("candidate verification binds exact bytes, membership and executable modes", async () => {
  const file = { path: "package.json", bytes: Buffer.from("{}"), mode: "100644" as const };
  const tree = await readRepositoryTree(transport([], [entry(file.path, blobHash(file.bytes))]), head);
  assert.doesNotThrow(() => verifyCandidateTree([file], tree));
  assert.throws(() => verifyCandidateTree([{ ...file, mode: "100755" }], tree), /mode|bytes/i);
  assert.throws(() => verifyCandidateTree([{ ...file, bytes: Buffer.from("changed") }], tree), /mode|bytes/i);
  tree.set("extra.ts", entry("extra.ts") as any);
  assert.throws(() => verifyCandidateTree([file], tree), /membership/i);
});
