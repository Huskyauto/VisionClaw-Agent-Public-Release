import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { captureVerifierSource, hashVerifierSourceFiles } from "./workspace-verifier-source";
import { HASH_PATTERN } from "./workspace-verifier-contract";

export const VERIFIER_SOURCE_ARTIFACT = "workspace-verifier-source.json.gz";
const MAX_ARTIFACT_BYTES = 96 * 1024 ** 2;
type Source = ReturnType<typeof captureVerifierSource>;

/** Build-only private source artifact. Never exposed as a public download. */
export function encodeVerifierSourceArtifact(source: Source): Buffer {
  return gzipSync(JSON.stringify({
    version: 1, contextSha256: source.hash,
    files: [...source.files].map(([name, content]) => [name, content.toString("base64")]),
  }));
}

export function readVerifierSourceArtifact(filename: string): Source {
  if (!lstatSync(filename).isFile()) throw new Error("Source artifact must be a regular file");
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let compressed: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) throw new Error("Invalid source artifact");
    compressed = Buffer.alloc(stat.size + 1);
    let length = 0, count: number;
    while (length < compressed.length
      && (count = readSync(fd, compressed, length, compressed.length - length, null)) > 0) length += count;
    if (length !== stat.size) throw new Error("Source artifact changed during read");
    compressed = compressed.subarray(0, length);
  } finally { closeSync(fd); }
  const value = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_ARTIFACT_BYTES * 2 }).toString("utf8"));
  if (value?.version !== 1 || typeof value.contextSha256 !== "string"
    || !HASH_PATTERN.test(value.contextSha256) || !Array.isArray(value.files) || value.files.length > 3000) {
    throw new Error("Invalid source artifact manifest");
  }
  const files = new Map<string, Buffer>();
  let bytes = 0;
  for (const entry of value.files) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid source artifact entry");
    const [name, encoded] = entry;
    if (typeof name !== "string" || name.length > 2048 || name.split("/").some(p => !p || p === "." || p === "..")
      || !/^(?:(?:server|shared|client\/src|scripts)\/[a-zA-Z0-9_./-]+\.(?:[cm]?[jt]sx?|json)|docs\/release-facts\.json|package(?:-lock)?\.json|tsconfig(?:\.[a-zA-Z0-9_.-]+)?\.json|[a-zA-Z0-9_.-]+\.config\.[cm]?[jt]s)$/.test(name)
      || files.has(name) || typeof encoded !== "string" || encoded.length > 3 * 1024 ** 2
      || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new Error("Unsafe source artifact entry");
    }
    const content = Buffer.from(encoded, "base64");
    if (content.toString("base64") !== encoded) throw new Error("Invalid source artifact encoding");
    bytes += content.length;
    if (content.length > 2 * 1024 ** 2 || bytes > MAX_ARTIFACT_BYTES) throw new Error("Source artifact exceeds limits");
    files.set(name, content);
  }
  for (const name of ["package.json", "package-lock.json", "tsconfig.json"]) {
    if (!files.has(name)) throw new Error("Incomplete source artifact");
  }
  const hash = hashVerifierSourceFiles(files);
  if (hash !== value.contextSha256) throw new Error("Source artifact hash mismatch");
  return { hash, files };
}

let deployedSource: Source | undefined;
/** Production authority is the exact build input, not a mutable runtime checkout. */
export function captureDeployedVerifierSource(): Source {
  if (process.env.NODE_ENV !== "production") return captureVerifierSource();
  return deployedSource ??= readVerifierSourceArtifact(join(process.cwd(), "dist", VERIFIER_SOURCE_ARTIFACT));
}
