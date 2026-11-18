import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { sanitizeSpawnEnv } from "../server/safety/spawn-env-guard";
import { readLegionRunbook, LEGION_RUNBOOKS, stagedRunbookPath } from "../server/legion/runbook-source";

/** Same fixed archive/hash as nix/legion-tailscale.nix. Download at build time,
 * never runtime; publication carries binaries, not a workspace/Nix symlink. */
export async function stageLegionBinaries(destination = "dist/legion/bin") {
  const dir = await mkdtemp(join(tmpdir(), "legion-build-"));
  try {
  const response = await fetch("https://pkgs.tailscale.com/stable/tailscale_1.104.7_amd64.tgz",
    { redirect: "error", signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new Error("Legion archive unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024 * 1024) throw new Error("Legion archive exceeds build bound");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (createHash("sha256").update(bytes).digest("hex") !==
      "e56693ff74a64f2591b7e819c280635a100aae1ddfb0ef058fcd052b7cd8d16c") {
    throw new Error("Legion archive checksum mismatch");
  }
  const archive = join(dir, "tailscale.tgz");
  await writeFile(archive, bytes, { mode: 0o600, flag: "wx" });
  await promisify(execFile)("tar", ["-xzf", archive, "-C", dir, "--strip-components=1",
    "tailscale_1.104.7_amd64/tailscaled", "tailscale_1.104.7_amd64/tailscale"], {
    timeout: 30_000, maxBuffer: 256_000, env: sanitizeSpawnEnv({ PATH: process.env.PATH }),
  });
  await mkdir(destination, { recursive: true });
  for (const binary of ["tailscaled", "tailscale"]) {
    const target = join(destination, binary);
    await copyFile(join(dir, binary), target);
    await chmod(target, 0o755);
  }
  console.log("[build] staged pinned Legion Tailscale 1.104.7 binaries");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function stageLegionRunbooks() {
  await mkdir("dist/legion/runbooks", { recursive: true });
  for (let index = 0; index < LEGION_RUNBOOKS.length; index++) {
    const source = await readLegionRunbook(LEGION_RUNBOOKS[index], "source");
    await writeFile(stagedRunbookPath(index), source.text, { mode: 0o644 });
  }
  console.log("[build] staged three screened, fixed Legion runbooks");
}
