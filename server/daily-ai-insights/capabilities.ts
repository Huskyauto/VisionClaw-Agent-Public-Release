import { createHash } from "node:crypto";
import { lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isProductionRuntime } from "../lib/runtime-env";

export interface Capability { path: string; digest: string; text: string }
export const CAPABILITY_ASSET = "daily-ai-insights-capabilities.json";
const PATHS = ["server/cron-utils.ts", "server/lib/ssrf-jail.ts",
  "server/lib/tenant-context.ts", "server/job-queue.ts"] as const;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Build-time fixed allowlist, not a general file reader. Digests bind exactly
 * the supplied excerpts, not an unshipped remainder of the source file. */
export async function captureCapabilities(root: string) {
  return { version: 1, entries: await Promise.all(PATHS.map(async path => {
    const text = (await readFile(join(root, path), "utf8")).slice(0, 7000);
    return { path, digest: digest(text), text };
  })) };
}

/** Shared by the real build and deployment-layout test. */
export async function stageCapabilities(root: string, output = join(root, "dist")) {
  const snapshot = await captureCapabilities(root);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, CAPABILITY_ASSET), JSON.stringify(snapshot), { mode: 0o600 });
  return snapshot;
}

export async function readCapabilities(): Promise<Capability[]> {
  if (!isProductionRuntime()) return (await captureCapabilities(process.cwd())).entries;
  const filename = join(process.cwd(), "dist", CAPABILITY_ASSET);
  const info = await lstat(filename);
  if (!info.isFile() || info.size > 256 * 1024) throw new Error("Invalid capability source artifact");
  const artifact = JSON.parse(await readFile(filename, "utf8"));
  if (artifact?.version !== 1 || !Array.isArray(artifact.entries) || artifact.entries.length !== PATHS.length)
    throw new Error("Invalid capability source artifact");
  return artifact.entries.map((entry: any, index: number) => {
    if (!entry || entry.path !== PATHS[index] || typeof entry.text !== "string" ||
        entry.text.length < 30 || entry.text.length > 7000 || entry.digest !== digest(entry.text))
      throw new Error("Invalid capability source artifact");
    return { path: entry.path, digest: entry.digest, text: entry.text };
  });
}
