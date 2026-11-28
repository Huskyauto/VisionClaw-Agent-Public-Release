#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

function assertPortableLockBeforeRemote(root: string): void {
  const envKeys = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  const env = Object.fromEntries(envKeys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  const result = spawnSync(process.execPath, [
    "--test",
    "--test-name-pattern=^every locked tarball",
    path.resolve(root, "tests/deployment/portable-install.test.cjs"),
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env,
  });
  if (result.error || result.status !== 0)
    throw new Error("Nonportable or integrity-free package downloads; remote checks did not start");
}

function parseStateArg(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--state" && args[1]) return args[1];
  throw new Error("Usage: prepublish [--state .local/remote-release/state-<current-digest>.json]");
}

export async function main(args = process.argv.slice(2)) {
  process.exitCode = undefined;
  const statePath = parseStateArg(args);
  assertPortableLockBeforeRemote(process.cwd());
  const [{ main: remoteReleaseMain }, { runPrepublishRemoteGate }] = await Promise.all([
    import("./remote-release"),
    import("./lib/prepublish-remote-gate"),
  ]);
  const receipt = await runPrepublishRemoteGate({
    statePath,
    collectRemote: async (remoteArgs: string[]) => {
      const log = console.log;
      console.log = () => {};
      try {
        return await remoteReleaseMain(remoteArgs);
      } finally {
        console.log = log;
      }
    },
  });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
