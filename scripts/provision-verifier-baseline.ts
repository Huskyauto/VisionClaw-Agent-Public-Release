/**
 * Explicit operator command. Never run on a guessed production revision.
 * Copies bounded source only, then installs its exact lock without scripts,
 * tokens, app data, application DB access, or the development node_modules.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captureVerifierSource } from "../server/lib/workspace-verifier-source";
import { captureVerifierDependencies, readVerifierBaseline } from "../server/lib/workspace-verifier-baseline";
import { HASH_PATTERN } from "../server/lib/workspace-verifier-contract";
import { readVerifierSourceArtifact } from "../server/lib/workspace-verifier-source-artifact";

export function provisionVerifierBaseline(sourceRoot: string, expectedHash: string, destination: string): void {
  if (!HASH_PATTERN.test(expectedHash)) throw new Error("Expected deployed context hash required");
  const source = lstatSync(sourceRoot).isDirectory()
    ? captureVerifierSource(sourceRoot) : readVerifierSourceArtifact(sourceRoot);
  if (source.hash !== expectedHash) throw new Error("Source export does not match deployed context");
  const root = resolve(destination);
  // Exclusive creation: never replace an existing baseline or the checkout.
  mkdirSync(root, { mode: 0o700 });
  try {
    for (const name of ["server", "shared", "client/src"]) mkdirSync(join(root, name), { recursive: true, mode: 0o700 });
    for (const [name, content] of source.files) {
      mkdirSync(dirname(join(root, name)), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, name), content, { flag: "wx", mode: 0o400 });
    }
    // npm receives no app secrets, database URL, NODE_OPTIONS or owner tokens.
    // Ignore even user/project npm config; registry and lifecycle policy are fixed.
    writeFileSync(join(root, ".npm-user-config"), "", { flag: "wx", mode: 0o600 });
    writeFileSync(join(root, ".npm-global-config"), "", { flag: "wx", mode: 0o600 });
    const install = spawnSync("npm", [
      "ci", "--ignore-scripts", "--include=dev", "--legacy-peer-deps", "--no-audit", "--no-fund",
      "--registry=https://registry.npmjs.org",
      `--userconfig=${join(root, ".npm-user-config")}`, `--globalconfig=${join(root, ".npm-global-config")}`,
    ], {
      cwd: root, shell: false, timeout: 300_000, stdio: "pipe", encoding: "utf8", maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH, HOME: realpathSync(root),
        npm_config_cache: join(root, ".npm-cache"),
      },
    });
    if (install.error || install.status !== 0) {
      // Only a fixed-shape npm code may cross the operator boundary. Never
      // reflect registry URLs, credentials, package output or paths.
      const code = String(install.stderr ?? "").match(/npm (?:ERR!|error) code ([A-Z][A-Z0-9_]{0,30})\b/)?.[1];
      throw new Error(`Private lockfile dependency installation failed (${code ?? "INSTALL_FAILED"})`);
    }
    rmSync(join(root, ".npm-cache"), { recursive: true, force: true });
    for (const name of ["typescript/lib/typescript.js", "tsx/dist/loader.mjs"]) {
      const file = realpathSync(join(root, "node_modules", name));
      if (!file.startsWith(realpathSync(join(root, "node_modules")) + sep) || !lstatSync(file).isFile()) {
        throw new Error("Private compiler assets unavailable");
      }
    }
    const manifest = {
      version: 1, contextSha256: expectedHash,
      dependenciesSha256: captureVerifierDependencies(root),
    };
    writeFileSync(join(root, ".verifier-baseline.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o400 });
    readVerifierBaseline(root);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error("Usage: provision-verifier-baseline <exact-source-directory-or-build-artifact> <deployed-context-sha256> <new-private-directory>");
    process.exitCode = 1;
  } else {
    try {
      provisionVerifierBaseline(args[0], args[1], args[2]);
      console.info("[workspace-verifier] sealed baseline provisioned; activation remains an explicit operator action");
    } catch (error) {
      const code = error instanceof Error
        ? error.message.match(/^Private lockfile dependency installation failed \(([A-Z][A-Z0-9_]{0,30})\)$/)?.[1]
        : undefined;
      console.error(`[workspace-verifier] baseline provisioning failed${code ? ` (${code})` : ""}; source, destination and dependency checks remain required`);
      process.exitCode = 1;
    }
  }
}
