import { createHash } from "node:crypto";
import path from "node:path";
import { REMOTE_RELEASE_REPO } from "./remote-release-contract";
import { releaseInputPaths, validReleasePath } from "./targeted-release-check";
import type { CandidateFile, GitHubRequest } from "./remote-release-candidate";

const API = `/repos/${REMOTE_RELEASE_REPO}`;
const SHA = /^[a-f0-9]{40}$/;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
export interface GitTreeBlob { path: string; sha: string; mode: string; type: string }

async function metadata(request: GitHubRequest, route: string): Promise<any> {
  const response = await request(API + route, { method: "GET" });
  if (!response.ok || response.redirected || !response.body)
    throw Error(`Cannot read complete Git source metadata (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_METADATA_BYTES) {
        await reader.cancel();
        throw Error("Git source metadata exceeds its bounded size");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Complete metadata comparison; the REST compare endpoint silently caps files at 300. */
export async function readRepositoryTree(request: GitHubRequest, commit: string): Promise<Map<string, GitTreeBlob>> {
  if (!SHA.test(commit)) throw Error("Invalid Git source commit identity");
  const record = await metadata(request, `/git/commits/${commit}`);
  return readGitTree(request, record?.tree?.sha);
}

export async function readGitTree(request: GitHubRequest, treeSha: string): Promise<Map<string, GitTreeBlob>> {
  if (!SHA.test(treeSha)) throw Error("Invalid Git source tree identity");
  const tree = await metadata(request, `/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 30_000)
    throw Error("Git source tree inventory is incomplete or oversized");
  const blobs = new Map<string, GitTreeBlob>();
  const seen = new Set<string>();
  for (const item of tree.tree) {
    if (!validReleasePath(item?.path) || path.posix.normalize(item.path) !== item.path ||
        !SHA.test(item.sha) || !["blob", "tree"].includes(item.type))
      throw Error("Unsafe Git source tree entry");
    if (seen.has(item.path)) throw Error("Duplicate Git source tree entry");
    seen.add(item.path);
    if (item.type === "blob") {
      if (!["100644", "100755", "120000"].includes(item.mode)) throw Error("Unsafe Git blob mode");
      blobs.set(item.path, item);
    }
  }
  if (blobs.size > 15_000) throw Error("Git source membership exceeds its bounded size");
  return blobs;
}

export async function changedRepositoryPaths(request: GitHubRequest, base: string, head: string): Promise<string[]> {
  const before = await readRepositoryTree(request, base);
  const after = await readRepositoryTree(request, head);
  return [...new Set([...before.keys(), ...after.keys()])].filter(file => {
    const a = before.get(file), b = after.get(file);
    return !a || !b || a.sha !== b.sha || a.mode !== b.mode;
  }).sort();
}

export function verifyCandidateTree(files: CandidateFile[], blobs: Map<string, GitTreeBlob>): void {
  const remotePaths = releaseInputPaths([...blobs.keys()], []);
  if (remotePaths.length !== files.length) throw Error("Candidate Git source membership differs");
  for (const file of files) {
    const sha = createHash("sha1").update(`blob ${file.bytes.length}\0`).update(file.bytes).digest("hex");
    const saved = blobs.get(file.path);
    if (saved?.sha !== sha || saved.mode !== file.mode)
      throw Error(`Candidate Git source bytes/mode differ: ${file.path}`);
  }
}
