import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  readdirSync, readlinkSync, realpathSync,
} from "node:fs";
import { join, sep } from "node:path";
import { captureVerifierSource, stageVerifierSource } from "./workspace-verifier-source";
import { HASH_PATTERN } from "./workspace-verifier-contract";

export interface VerifierBaseline {
  version: 1;
  contextSha256: string;
  dependenciesSha256: string;
}

/**
 * Seal actual installed bytes, not only package.json versions. Stream bounded
 * reads: large native/compiler files must not be allocated into worker memory.
 * Internal npm symlinks are allowed, external dependency links are not.
 */
export function captureVerifierDependencies(root: string): string {
  const directory = join(realpathSync(root), "node_modules");
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error("Verifier dependencies require a private installed directory");
  }
  const base = realpathSync(directory);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let entries = 0, bytes = 0;
  const walk = (name: string): void => {
    if (++entries > 200_000 || name.length > 2048) throw new Error("Dependency traversal exceeds limits");
    const filename = join(base, name);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(filename);
      if (!target.startsWith(base + sep)) throw new Error("Dependency symlink outside private baseline");
      hash.update(JSON.stringify(["link", name, readlinkSync(filename)]));
    } else if (stat.isDirectory()) {
      hash.update(JSON.stringify(["directory", name]));
      for (const child of readdirSync(filename).sort()) walk(name ? `${name}/${child}` : child);
    } else {
      if (!stat.isFile()) throw new Error("Dependency must be a regular file");
      const parent = realpathSync(join(filename, ".."));
      if (parent !== base && !parent.startsWith(base + sep)) throw new Error("Dependency parent outside baseline");
      const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = fstatSync(fd);
        // Installed Claude/Copilot native SDK binaries exceed 128 MiB.
        // This is a disk-read ceiling, not an allocation: the fixed 64 KiB
        // streaming buffer above is unchanged. Keep file/tree/entry bounds.
        if (!current.isFile() || current.size > 512 * 1024 ** 2) throw new Error("Invalid dependency file");
        hash.update(JSON.stringify(["file", name, current.size]));
        let length = 0, count: number;
        while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
          length += count;
          bytes += count;
          if (length > current.size || bytes > 8 * 1024 ** 3) throw new Error("Dependency bytes exceed limits");
          hash.update(buffer.subarray(0, count));
        }
        if (length !== current.size) throw new Error("Dependency changed during capture");
      } finally { closeSync(fd); }
    }
  };
  walk("");
  return hash.digest("hex");
}

export function readVerifierBaseline(root: string): VerifierBaseline {
  if (realpathSync(root) === realpathSync(process.cwd())) throw new Error("Baseline must be separate from the running checkout");
  if (!lstatSync(join(root, ".verifier-baseline.json")).isFile()) throw new Error("Baseline manifest must be regular");
  const fd = openSync(join(root, ".verifier-baseline.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest: VerifierBaseline;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 2048) throw new Error("Invalid verifier baseline manifest");
    const bytes = Buffer.alloc(2049);
    const length = readSync(fd, bytes, 0, bytes.length, null);
    if (length > 2048) throw new Error("Verifier baseline manifest exceeds limit");
    manifest = JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally { closeSync(fd); }
  if (manifest?.version !== 1 || typeof manifest.contextSha256 !== "string"
    || !HASH_PATTERN.test(manifest.contextSha256)
    || typeof manifest.dependenciesSha256 !== "string" || !HASH_PATTERN.test(manifest.dependenciesSha256)) {
    throw new Error("Invalid verifier baseline manifest");
  }
  if (captureVerifierSource(root).hash !== manifest.contextSha256) throw new Error("Verifier baseline source changed");
  if (captureVerifierDependencies(root) !== manifest.dependenciesSha256) throw new Error("Verifier baseline dependencies changed");
  return manifest;
}

export function stageSealedVerifierBaseline(root: string, expectedHash: string) {
  const manifest = readVerifierBaseline(root);
  if (manifest.contextSha256 !== expectedHash) throw new Error("Sealed baseline context mismatch");
  const staged = stageVerifierSource(root, expectedHash);
  return {
    ...staged,
    assertUnchanged: () => {
      const current = readVerifierBaseline(root);
      if (current.contextSha256 !== expectedHash
        || current.dependenciesSha256 !== manifest.dependenciesSha256) {
        throw new Error("Sealed baseline changed during verification");
      }
    },
  };
}
