import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const INCLUDED_CONFIG = [
  "scripts/tenant-isolation-audit.ts",
  "scripts/lib/tenant-audit-checkpoint.ts",
  "scripts/lib/tenant-audit-evidence-hash.ts",
  "scripts/lib/tenant-audit-schema-index.ts",
  "shared/schema.ts",
  "data/tenant-isolation-audit/suppressions.json",
  "data/tenant-isolation-audit/deferrals.json",
];

function walkTypescript(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      walkTypescript(full, out);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
}

export function computeTenantAuditEvidenceHash(root = path.resolve(".")): string {
  const serverRoot = path.join(root, "server");
  const files: string[] = [];
  walkTypescript(serverRoot, files);
  for (const rel of INCLUDED_CONFIG) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) files.push(full);
  }
  files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));

  const hash = createHash("sha256");
  hash.update("tenant-audit-evidence-v1\0");
  for (const file of files) {
    const rel = path.relative(root, file);
    const body = fs.readFileSync(file);
    hash.update(rel);
    hash.update("\0");
    hash.update(String(body.length));
    hash.update("\0");
    hash.update(body);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function computeTenantAuditCheckpointSourceHash(
  evidenceHash: string,
  configuration: unknown,
  chunks: readonly { files: readonly string[]; text: string }[],
): string {
  const hash = createHash("sha256");
  hash.update("tenant-audit-checkpoint-v2\0");
  hash.update(evidenceHash);
  hash.update("\0");
  hash.update(JSON.stringify(configuration));
  hash.update("\0");
  for (const chunk of chunks) {
    hash.update(chunk.files.join("\0"));
    hash.update("\0");
    hash.update(chunk.text);
    hash.update("\0");
  }
  return hash.digest("hex");
}