import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_FILES = 3000;

/** Exact compiler source/config inputs, excluding private data and runtime files. */
export function captureVerifierSource(root = process.cwd()): { hash: string; files: Map<string, Buffer> } {
  const base = realpathSync(root);
  const files = new Map<string, Buffer>();
  let bytes = 0;
  let entries = 0;
  const read = (name: string) => {
    const filename = join(base, name);
    const parent = realpathSync(dirname(filename));
    if (parent !== base && !parent.startsWith(base + sep)) throw new Error("Source parent outside checkout");
    const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Source must be a bounded regular file");
      // A writer growing the file after fstat must not defeat the byte bound.
      const buffer = Buffer.allocUnsafe(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length === buffer.length) throw new Error("Source grew during bounded capture");
      const content = buffer.subarray(0, length);
      bytes += content.length;
      if (content.length > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES || files.size >= MAX_FILES) {
        throw new Error("Verifier source exceeds capture limits");
      }
      files.set(name, content);
    } finally { closeSync(fd); }
  };
  const walk = (name: string) => {
    if (++entries > 12_000 || name.length > 2048) throw new Error("Source traversal exceeds capture limits");
    const filename = join(base, name);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error("Verifier source symlink rejected");
    if (stat.isDirectory()) {
      for (const item of readdirSync(filename).sort()) walk(`${name}/${item}`);
    } else if (/\.(?:[cm]?[jt]sx?|json)$/.test(name)) {
      if (!stat.isFile()) throw new Error("Verifier source must be regular");
      read(name);
    }
  };
  for (const name of ["package.json", "package-lock.json", "tsconfig.json"]) read(name);
  // Public build data imported by client source. Never walk arbitrary docs:
  // that would admit private reports/runbooks into the service snapshot.
  for (const name of ["docs/release-facts.json"]) {
    try { lstatSync(join(base, name)); } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    read(name);
  }
  for (const name of readdirSync(base).sort()) {
    // Root build configs may be imported by server modules. Do not capture
    // private root JSON, env files, runtime state or arbitrary owner scripts.
    if (/^[a-zA-Z0-9_.-]+\.config\.[cm]?[jt]s$/.test(name)
      || /^tsconfig\.[a-zA-Z0-9_.-]+\.json$/.test(name)) read(name);
  }
  for (const name of ["server", "shared", "client/src"]) walk(name);
  // Scripts can be explicit proposal targets or imported by server modules.
  try { lstatSync(join(base, "scripts")); } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (readdirSync(base).includes("scripts")) walk("scripts");
  const hash = createHash("sha256");
  for (const [name, content] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(`${Buffer.byteLength(name)}:${name}:${content.length}:`).update(content);
  }
  return { hash: hash.digest("hex"), files };
}

/** No live source writes; dependency install is trusted, source bytes are sealed. */
export function stageVerifierSource(root: string, expectedHash: string) {
  const source = captureVerifierSource(root);
  if (source.hash !== expectedHash) throw new Error("Worker source baseline mismatch");
  const staging = mkdtempSync(join(tmpdir(), "visionclaw-verifier-"));
  const cleanup = () => rmSync(staging, { recursive: true, force: true });
  try {
    for (const name of ["server", "shared", "client/src"]) {
      mkdirSync(join(staging, name), { recursive: true, mode: 0o700 });
    }
    for (const [name, content] of source.files) {
      const destination = resolve(staging, name);
      if (relative(staging, destination).startsWith("..")) throw new Error("Invalid staging source");
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, content, { mode: 0o400, flag: "wx" });
    }
    symlinkSync(realpathSync(join(root, "node_modules")), join(staging, "node_modules"), "dir");
    if (captureVerifierSource(staging).hash !== expectedHash) throw new Error("Staging source mismatch");
    return { root: staging, cleanup };
  } catch (error) { cleanup(); throw error; }
}
