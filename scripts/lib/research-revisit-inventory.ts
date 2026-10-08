import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { appendUnindexedResearchTopics, buildResearchRevisitReport } from "../../server/lib/research-revisit";

/** Reads only regular, bounded files inside the project memory directory. */
function inventory(memoryRoot?: string) {
  // The web server bundles this module; import.meta.dirname is unavailable in CJS.
  const root = memoryRoot ?? resolve(process.cwd(), ".agents/memory");
  const indexPath = join(root, "MEMORY.md");
  const indexStat = lstatSync(indexPath);
  if (!indexStat.isFile() || indexStat.size > 250_000) throw new Error("Invalid research memory index");
  const basenames = readdirSync(root);
  if (basenames.length > 1024) throw new Error("Research memory inventory exceeds file limit");
  let bytesRead = indexStat.size;
  const topics = new Map<string, string>();
  const readTopic = (basename: string) => {
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(basename)) throw new Error("Unsafe research memory topic path");
    const cached = topics.get(basename);
    if (cached !== undefined) return cached;
    const path = join(root, basename);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 50_000) throw new Error(`Invalid research memory topic: ${basename}`);
    if (bytesRead + stat.size > 8_000_000) throw new Error("Research memory inventory exceeds byte limit");
    bytesRead += stat.size;
    const body = readFileSync(path, "utf8");
    topics.set(basename, body);
    return body;
  };
  const index = appendUnindexedResearchTopics(
    readFileSync(indexPath, "utf8"), basenames, readTopic,
  );
  return { index, readTopic };
}

export function loadResearchRevisitReport(opts: { need?: string; now: Date; limit?: number }, memoryRoot?: string) {
  const { index, readTopic } = inventory(memoryRoot);
  return buildResearchRevisitReport(index, readTopic, opts);
}

/** Batch lookup reads each source file only once, even across several gaps. */
export function loadResearchRevisitReportsForNeeds(
  needs: string[], opts: { now: Date; limit?: number }, memoryRoot?: string,
) {
  if (needs.length > 10) throw new Error("Too many research gap needs");
  const { index, readTopic } = inventory(memoryRoot);
  return needs.map((need) => buildResearchRevisitReport(index, readTopic, { ...opts, need }));
}