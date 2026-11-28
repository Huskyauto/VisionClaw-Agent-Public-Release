import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  classifyReleaseScope, digestReleaseInputs, releaseInputPaths, validReleasePath,
} from "./targeted-release-check";
import { REMOTE_RELEASE_REPO } from "./remote-release-contract";
import { readGitTree, verifyCandidateTree } from "./remote-release-tree";

export type GitHubRequest = (route: string, init?: RequestInit) => Promise<Response>;
export interface CandidateFile { path: string; bytes: Buffer; mode: "100644" | "100755" }
export const blobHash = (bytes: Buffer) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const sha = /^[a-f0-9]{40}$/;
const prefix = `/repos/${REMOTE_RELEASE_REPO}`;
const MAX_FILES = 15_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_UPLOAD_PAYLOAD_BYTES = 12 * 1024 * 1024;
const MAX_TREE_PAYLOAD_BYTES = 4 * 1024 * 1024;

function normalizedReleasePath(file: string): boolean {
  return validReleasePath(file) && path.posix.normalize(file) === file;
}

export function readCandidate(root = process.cwd()) {
  const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", ...args],
    { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }).split("\0").filter(Boolean);
  const paths = releaseInputPaths([...git("ls-files", "-z"),
    ...git("ls-files", "--others", "--exclude-standard", "-z")], []);
  if (!paths.length || paths.length > MAX_FILES) throw Error("Candidate source membership limit");
  let total = 0;
  const files = paths.map(file => {
    if (!normalizedReleasePath(file)) throw Error("Unsafe or non-normalized candidate source path");
    const full = path.resolve(root, file);
    let stat;
    try { stat = lstatSync(full); }
    catch (error: any) {
      if (error.code === "ENOENT")
        throw Error(`Missing candidate source path; stage deletions before upload: ${file}`);
      throw error;
    }
    if (realpathSync(full) !== full || !stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw Error(`Candidate requires regular source bytes: ${file}`);
    total += stat.size;
    if (total > MAX_SOURCE_BYTES) throw Error("Candidate source exceeds 256 MiB; narrow retained source before upload");
    return { path: file, bytes: readFileSync(full), mode: stat.mode & 0o111 ? "100755" : "100644" } as CandidateFile;
  });
  return { files, sourceDigest: digestReleaseInputs(files.map(f =>
    ({ path: f.path, content: f.bytes.toString("base64") }))) };
}

/** Content identity is stable; modes are checked separately for local freshness. */
export function candidateSnapshotIdentity(candidate: ReturnType<typeof readCandidate>): string {
  return createHash("sha256").update(JSON.stringify({
    sourceDigest: candidate.sourceDigest,
    modes: candidate.files.map(file => [file.path, file.mode]).sort((a, b) => a[0].localeCompare(b[0])),
  })).digest("hex");
}

function assertUploadPathSafe(filePath: string) {
  const envPath = /(^|\/)\.env(?:$|\.)/i.test(filePath);
  const approvedEnvExample = /(^|\/)\.env\.example$/i.test(filePath);
  const privateNamespace = /(^|\/)(?:uploads?|attached_assets|backups?|backup[-_]files?|private(?:[-_]uploads?)?|customer[-_]uploads?|tenant[-_]uploads?|secrets?|tokens?|token[-_]store|credentials?)(?:\/|$)/i;
  const privateTokenFile = /(^|\/)(?:\.?token|access[-_]?token|refresh[-_]?token|credentials?|service[-_]?account)(?:\.(?:json|ya?ml|txt|env|pem|key))?$/i;
  if (!normalizedReleasePath(filePath) ||
      (envPath && !approvedEnvExample) ||
      /(^|\/)(?:id_(?:rsa|ed25519|dsa)|known_hosts)(?:$|\.)/i.test(filePath) ||
      /\.(?:pem|p12|pfx|key)$/i.test(filePath) ||
      privateNamespace.test(filePath) || privateTokenFile.test(filePath) ||
      /^(?:public-mirror|generated-artifacts|node_modules|\.local|\.git)\//i.test(filePath))
    throw Error(`Private/non-source candidate path refused: ${filePath}`);
}

export function assertUploadSafe(file: CandidateFile) {
  if (!file || !Buffer.isBuffer(file.bytes))
    throw Error("Private/non-source candidate bytes refused");
  assertUploadPathSafe(file.path);
  const text = file.bytes.toString("utf8");
  const scan = text + (file.bytes.includes(0) ? `\n${file.bytes.toString("utf16le")}` : "");
  const fullyMasked = (value: string): boolean => {
    try { value = decodeURIComponent(value); } catch { return false; }
    return /^(?:\*{3,}|\[REDACTED\])?$/i.test(value);
  };
  const safeCredentialComponent = (value: string, username = false): boolean => {
    try { value = decodeURIComponent(value); } catch { return false; }
    return fullyMasked(value) ||
      /^(?:\$\{[^}]+\}|\$\w+|\{\{[^}]+\}\}|<[^>]+>|process\.env\.[a-z_]\w*)$/i.test(value) ||
      /^(?:user|username|pass|password|secret|token|api[_-]?key|example|placeholder|dummy|fake|fixture|test|sample|offline|ci|redacted|changeme|replace|your(?:[_-][a-z0-9]+)*)$/i.test(value) ||
      (username && /^(?:operator|postgres|root|default|x-access-token)$/i.test(value));
  };
  const hasHighEntropyToken = (value: string): boolean => {
    if (value.length < 20 || /\b(?:example|placeholder|dummy|fake|fixture|test|sample|redacted|changeme|replace|your[_-]?key)\b/i.test(value))
      return false;
    const counts = new Map<string, number>();
    for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
    if (counts.size < 12) return false;
    const entropy = [...counts.values()].reduce((sum, count) => {
      const probability = count / value.length;
      return sum - probability * Math.log2(probability);
    }, 0);
    return entropy >= 3.5;
  };
  const tokenPatterns = [
    /\bsk-ant-(?:api\d{2}-)?([A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])/gi,
    /\bsk-proj-([A-Za-z0-9_-]{48,})(?![A-Za-z0-9_-])/gi,
    /\bsk-svcacct-([A-Za-z0-9_-]{48,})(?![A-Za-z0-9_-])/gi,
    /\bsk-([A-Za-z0-9]{40,})(?![A-Za-z0-9_-])/g,
    /\b(?:sk|rk)_live_([A-Za-z0-9]{24,})(?![A-Za-z0-9_-])/gi,
    /\bAIza([A-Za-z0-9_-]{35})(?![A-Za-z0-9_-])/g,
  ];
  const longKeyFound = tokenPatterns.some(pattern => {
    for (const match of scan.matchAll(pattern)) {
      if (match[1] && hasHighEntropyToken(match[1])) return true;
    }
    return false;
  });
  const urlWithEmbeddedCredentials = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|https?):\/\/[^\s"'`]+/gi;
  const realHostCredentials = [...scan.matchAll(urlWithEmbeddedCredentials)].some(match => {
    try {
      const parsed = new URL(match[0]);
      if (!parsed.username && !parsed.password) return false;
      if (fullyMasked(parsed.username) && fullyMasked(parsed.password)) return false;
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      const fixtureHost = hostname === "localhost" || hostname === "127.0.0.1" ||
        hostname === "::1" || hostname.endsWith(".invalid") || hostname.endsWith(".test") ||
        hostname === "example.com" || hostname.endsWith(".example.com");
      return !fixtureHost &&
        !(safeCredentialComponent(parsed.username, true) && safeCredentialComponent(parsed.password));
    } catch {
      const credentials = match[0].match(/\/\/([^/?#@]+)@/);
      if (!credentials || !credentials[1].includes(":")) return false;
      const [username, ...passwordParts] = credentials[1].split(":");
      const password = passwordParts.join(":");
      return !(safeCredentialComponent(username, true) && safeCredentialComponent(password));
    }
  });
  const fixedMarkers =
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\r?\n(?:[A-Za-z0-9+/=]{32,}\r?\n)+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(scan) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{70,}|AKIA[A-Z0-9]{16})\b/.test(scan);
  if (fixedMarkers || longKeyFound || realHostCredentials)
    throw Error(`Potential credential refused in candidate: ${file.path}`);
}

function snapshotCandidate(candidate: ReturnType<typeof readCandidate>): ReturnType<typeof readCandidate> {
  if (!candidate || !Array.isArray(candidate.files) || !candidate.files.length || candidate.files.length > MAX_FILES)
    throw Error("Candidate source membership limit");
  if (!/^[a-f0-9]{64}$/.test(candidate.sourceDigest)) throw Error("Invalid candidate digest");
  const seen = new Set<string>();
  let total = 0;
  const files: CandidateFile[] = candidate.files.map((input: CandidateFile) => {
    if (!input || typeof input.path !== "string" || !normalizedReleasePath(input.path))
      throw Error("Candidate contains an unsafe or non-normalized source path");
    if (seen.has(input.path)) throw Error(`Candidate contains duplicate path: ${input.path}`);
    seen.add(input.path);
    if (!Buffer.isBuffer(input.bytes)) throw Error(`Candidate source bytes are invalid: ${input.path}`);
    if (input.mode !== "100644" && input.mode !== "100755")
      throw Error(`Candidate source mode is invalid: ${input.path}`);
    const bytes = Buffer.from(input.bytes);
    if (bytes.length > MAX_FILE_BYTES) throw Error(`Candidate source file exceeds 10 MiB: ${input.path}`);
    total += bytes.length;
    if (total > MAX_SOURCE_BYTES) throw Error("Candidate source exceeds 256 MiB");
    return { path: input.path, bytes, mode: input.mode };
  });
  const actualDigest = digestReleaseInputs(files.map(file => ({
    path: file.path, content: file.bytes.toString("base64"),
  })));
  if (actualDigest !== candidate.sourceDigest)
    throw Error("Candidate source digest does not match the supplied file bytes");
  return { files, sourceDigest: actualDigest };
}

/** Creates an immutable test-only branch. Never updates a ref or opens a PR. */
export async function uploadCandidate(
  request: GitHubRequest, candidate: ReturnType<typeof readCandidate>, approved: boolean,
) {
  if (approved !== true) throw Error("Explicit test-only branch upload approval required");
  const snapshot = snapshotCandidate(candidate);
  const json = async (route: string, init?: RequestInit) => {
    const r = await request(prefix + route, init);
    if (!r.ok) throw Error(`GitHub candidate request failed (${r.status}); no automatic retry`);
    return r.json();
  };
  const post = (value: unknown): RequestInit => ({
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
  });
  const repo = await json("");
  if (repo.private !== true || repo.default_branch !== "main") throw Error("Expected private source repository");
  const main = await json("/git/ref/heads/main");
  if (!sha.test(main.object?.sha)) throw Error("Invalid remote source head");
  const baseCommit = await json(`/git/commits/${main.object.sha}`);
  const remote = await readGitTree(request, baseCommit.tree?.sha);
  const branch = `release-checks/${snapshot.sourceDigest}`;
  const prior = await request(prefix + `/git/ref/heads/${branch}`);
  if (prior.ok) throw Error("Candidate branch already exists; inspect its existing run instead of resubmitting");
  if (prior.status !== 404) throw Error("Cannot establish candidate branch absence");
  const localPaths = new Set(snapshot.files.map(f => f.path));
  const deletions = releaseInputPaths([...remote.keys()], []).filter(file => !localPaths.has(file));
  for (const file of deletions) {
    if (!normalizedReleasePath(file)) throw Error(`Unsafe remote source path cannot be deleted: ${file}`);
    assertUploadPathSafe(file);
  }

  const changedFiles = snapshot.files.filter(file => {
    const old = remote.get(file.path);
    return !old || old.sha !== blobHash(file.bytes) || old.mode !== file.mode;
  });
  const changedPaths = [...changedFiles.map(file => file.path), ...deletions].sort();
  for (const file of changedFiles) assertUploadSafe(file);
  const scope = classifyReleaseScope(changedPaths);
  if (scope.unknown.length)
    throw Error(`Candidate changes include unclassified paths; baseline/scope needs review before upload: ${scope.unknown.join(", ")}`);

  const tree: any[] = [];
  const binaryEntries: { file: CandidateFile; entry: any; content: string }[] = [];
  for (const file of changedFiles) {
    const old = remote.get(file.path);
    if (old && old.mode !== file.mode)
      throw Error(`Candidate executable mode change refused: ${file.path}`);
    if (!old && file.mode !== "100644")
      throw Error(`New candidate files must use mode 100644: ${file.path}`);
    if (old?.sha === blobHash(file.bytes) && old.mode === file.mode) continue;
    const text = file.bytes.toString("utf8");
    if (Buffer.from(text, "utf8").equals(file.bytes)) {
      tree.push({ path: file.path, mode: file.mode, type: "blob", content: text });
    } else {
      const content = file.bytes.toString("base64");
      const entry = { path: file.path, mode: file.mode, type: "blob", sha: "0".repeat(40) };
      tree.push(entry);
      binaryEntries.push({ file, entry, content });
    }
  }
  for (const file of deletions) {
    const old = remote.get(file);
    if (!old) throw Error("Remote deletion path disappeared from the source inventory");
    tree.push({ path: file, mode: old.mode, type: "blob", sha: null });
  }
  const commitMessage = `Test-only release checks ${snapshot.sourceDigest}`;
  const treeBody = { base_tree: baseCommit.tree.sha, tree };
  // GitHub's tree endpoint has a smaller request limit than the total upload.
  // Move the largest inline text to immutable blobs before any remote write.
  const inlineEntries = tree.filter(entry => typeof entry.content === "string")
    .sort((a, b) => Buffer.byteLength(b.content) - Buffer.byteLength(a.content));
  for (const entry of inlineEntries) {
    if (Buffer.byteLength(JSON.stringify(treeBody)) <= MAX_TREE_PAYLOAD_BYTES) break;
    const file = changedFiles.find(file => file.path === entry.path)!;
    binaryEntries.push({ file, entry, content: file.bytes.toString("base64") });
    delete entry.content;
    entry.sha = "0".repeat(40);
  }
  if (Buffer.byteLength(JSON.stringify(treeBody)) > MAX_TREE_PAYLOAD_BYTES)
    throw Error("Candidate Git tree metadata exceeds its upload budget");
  const commitBody = { message: commitMessage, tree: "0".repeat(40), parents: [main.object.sha] };
  const refBody = { ref: `refs/heads/${branch}`, sha: "0".repeat(40) };
  const payloadBytes = [
    ...binaryEntries.map(item => Buffer.byteLength(JSON.stringify({ content: item.content, encoding: "base64" }))),
    Buffer.byteLength(JSON.stringify(treeBody)),
    Buffer.byteLength(JSON.stringify(commitBody)),
    Buffer.byteLength(JSON.stringify(refBody)),
  ].reduce((sum, bytes) => sum + bytes, 0);
  if (payloadBytes > MAX_UPLOAD_PAYLOAD_BYTES)
    throw Error("Candidate changed payload exceeds 12 MiB upload budget");

  // GitHub Git Data writes immutable blobs/trees/commits before the final ref.
  // Failed attempts can leave unreachable objects; budget is preflighted first,
  // and no retry is attempted because the final ref response may be uncertain.
  for (const item of binaryEntries) {
    const blob = await json("/git/blobs", post({ content: item.content, encoding: "base64" }));
    if (blob.sha !== blobHash(item.file.bytes)) throw Error("GitHub did not preserve candidate blob");
    item.entry.sha = blob.sha;
  }
  const createdTree = await json("/git/trees", post(treeBody));
  if (!sha.test(createdTree.sha)) throw Error("Invalid candidate tree");
  verifyCandidateTree(snapshot.files, await readGitTree(request, createdTree.sha));
  const commit = await json("/git/commits", post({
    message: commitMessage, tree: createdTree.sha, parents: [main.object.sha],
  }));
  if (!sha.test(commit.sha)) throw Error("Invalid candidate commit");
  // This is the only ref write. A lost response is uncertain, never retried.
  await json("/git/refs", post({ ref: refBody.ref, sha: commit.sha }));
  return { branch, head: commit.sha as string, base: main.object.sha as string, repositoryId: repo.id as number };
}
