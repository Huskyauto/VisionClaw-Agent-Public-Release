import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, openSync, ftruncateSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureVerifierSource } from "../../server/lib/workspace-verifier-source";
import { captureVerifierDependencies, readVerifierBaseline } from "../../server/lib/workspace-verifier-baseline";
import { encodeVerifierSourceArtifact, readVerifierSourceArtifact } from "../../server/lib/workspace-verifier-source-artifact";
import { provisionVerifierBaseline } from "../../scripts/provision-verifier-baseline";
import { gzipSync } from "node:zlib";

test("dependency seals stream large installed SDK binaries but retain a fixed file ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-large-sdk-"));
  try {
    mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
    const file = join(root, "node_modules/pkg/sdk.bin");
    const fd = openSync(file, "w");
    ftruncateSync(fd, 129 * 1024 ** 2);
    closeSync(fd);
    assert.match(captureVerifierDependencies(root), /^[a-f0-9]{64}$/);
    const fd2 = openSync(file, "w");
    ftruncateSync(fd2, 513 * 1024 ** 2);
    closeSync(fd2);
    assert.throws(() => captureVerifierDependencies(root), /Invalid dependency file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("private install failures expose a safe npm code, never raw stderr", () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-install-error-"));
  const originalPath = process.env.PATH;
  try {
    const sourceRoot = join(root, "source");
    mkdirSync(sourceRoot);
    for (const name of ["server", "shared", "client/src"])
      mkdirSync(join(sourceRoot, name), { recursive: true });
    for (const name of ["package.json", "package-lock.json", "tsconfig.json"])
      writeFileSync(join(sourceRoot, name), "{}");
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 'npm error code EUSAGE' >&2\necho 'PRIVATE-CREDENTIAL-DO-NOT-PRINT' >&2\nexit 1\n", { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath}`;
    assert.throws(() => provisionVerifierBaseline(sourceRoot, captureVerifierSource(sourceRoot).hash, join(root, "baseline")),
      (error: any) => /EUSAGE/.test(error.message) && !/PRIVATE-CREDENTIAL/.test(error.message));
    assert.equal(existsSync(join(root, "baseline")), false);
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("sealed baselines require their own dependency tree and reject changed installed bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-fixture-"));
  try {
    for (const name of ["server", "shared", "client/src", "node_modules/pkg"])
      mkdirSync(join(root, name), { recursive: true });
    for (const name of ["package.json", "package-lock.json", "tsconfig.json"])
      writeFileSync(join(root, name), "{}");
    writeFileSync(join(root, "node_modules/pkg/index.js"), "export const value=1");
    assert.throws(() => readVerifierBaseline(root));
    const contextSha256 = captureVerifierSource(root).hash;
    const dependenciesSha256 = captureVerifierDependencies(root);
    writeFileSync(join(root, ".verifier-baseline.json"), JSON.stringify({
      version: 1, contextSha256, dependenciesSha256,
    }));
    assert.equal(readVerifierBaseline(root).contextSha256, contextSha256);
    writeFileSync(join(root, "node_modules/pkg/index.js"), "export const value=2");
    assert.throws(() => readVerifierBaseline(root), /dependenc/i);
    symlinkSync("/etc/hosts", join(root, "node_modules/pkg/external"));
    assert.throws(() => captureVerifierDependencies(root), /outside/i);
    rmSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(process.cwd() + "/node_modules", join(root, "node_modules"));
    assert.throws(() => captureVerifierDependencies(root), /private/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("private build source artifacts roundtrip exact bytes and refuse unsafe entries", () => {
  const root = mkdtempSync(join(tmpdir(), "source-artifact-fixture-"));
  try {
    const files = new Map([
      ["package.json", Buffer.from("{}")], ["package-lock.json", Buffer.from("{}")],
      ["tsconfig.json", Buffer.from("{}")],
      ["server/example.ts", Buffer.from("x".repeat(2 * 1024 ** 2))],
    ]);
    const filename = join(root, "source.json.gz");
    // Use actual source hashing, including a maximum-size source file.
    for (const name of ["server", "shared", "client/src"]) mkdirSync(join(root, name), { recursive: true });
    for (const [name, content] of files) writeFileSync(join(root, name), content);
    const source = captureVerifierSource(root);
    writeFileSync(filename, encodeVerifierSourceArtifact(source));
    assert.equal(readVerifierSourceArtifact(filename).hash, source.hash);
    for (const name of ["../escape.ts", "/server/example.ts", "data/private.json", "server/../escape.ts"]) {
      writeFileSync(filename, gzipSync(JSON.stringify({
        version: 1, contextSha256: source.hash, files: [[name, "eA=="]],
      })));
      assert.throws(() => readVerifierSourceArtifact(filename), /entry/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("operator provisioning refuses guessed source, isolates install secrets and seals dependency bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "provision-fixture-"));
  const originalPath = process.env.PATH;
  const secretName = "BASELINE_FIXTURE_SECRET";
  process.env[secretName] = "must-not-inherit";
  try {
    const sourceRoot = join(root, "export");
    for (const name of ["server", "shared", "client/src"]) mkdirSync(join(sourceRoot, name), { recursive: true });
    for (const name of ["package.json", "package-lock.json", "tsconfig.json"])
      writeFileSync(join(sourceRoot, name), "{}");
    const source = captureVerifierSource(sourceRoot);
    const destination = join(root, "baseline");
    assert.throws(() => provisionVerifierBaseline(sourceRoot, "f".repeat(64), destination), /match/);
    assert.equal(existsSync(destination), false);
    // Offline executable fixture: tests the real provisioning process boundary,
    // not npm's network or registry behavior. No packages are installed here.
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "npm"), `#!/bin/sh
set -eu
test -z "\${BASELINE_FIXTURE_SECRET:-}"
test -z "\${DATABASE_URL:-}"
case "$*" in *--ignore-scripts*--include=dev*) ;; *) exit 7 ;; esac
case "$*" in *--legacy-peer-deps*) ;; *) exit 8 ;; esac
mkdir -p node_modules/typescript/lib node_modules/tsx/dist
printf 'compiler fixture' > node_modules/typescript/lib/typescript.js
printf 'loader fixture' > node_modules/tsx/dist/loader.mjs
`, { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath}`;
    provisionVerifierBaseline(sourceRoot, source.hash, destination);
    assert.equal(readVerifierBaseline(destination).contextSha256, source.hash);
    assert.equal(existsSync(join(sourceRoot, "node_modules")), false);
    assert.throws(() => provisionVerifierBaseline(sourceRoot, source.hash, destination), /exist/i);
    assert.equal(readVerifierBaseline(destination).contextSha256, source.hash);
    writeFileSync(join(destination, "node_modules/typescript/lib/typescript.js"), "changed");
    assert.throws(() => readVerifierBaseline(destination), /dependenc/i);
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    delete process.env[secretName];
    rmSync(root, { recursive: true, force: true });
  }
});
