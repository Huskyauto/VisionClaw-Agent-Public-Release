/**
 * R79.3e — CI catalog stub seeder.
 *
 * Background: `server/product-catalog.ts` exports a hardcoded CATALOG map
 * whose entries reference real on-disk files under `project-assets/` (the
 * customer-facing static products). That directory is gitignored — the real
 * payloads ship via Drive, not git — so a fresh CI checkout has none of them.
 * Tests that exercise `/api/store/checkout` then 500 with
 * "Catalog file does not exist on disk: project-assets/...".
 *
 * This script extracts every `filePath: 'project-assets/...'` literal from
 * `server/product-catalog.ts` and writes a minimal stub at each path so the
 * existsSync check in `resolveAndCheck()` passes. Stubs are 32 bytes each.
 *
 * Run before the security gate: `npx tsx tests/fixtures/seed-catalog-files.ts`.
 *
 * Local behavior: a no-op for any file that already exists (your real
 * project-assets aren't touched).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const CATALOG_SRC = path.join(ROOT, "server/product-catalog.ts");

function extractPaths(source: string): string[] {
  // Match: filePath: 'project-assets/foo.ext'  or  "project-assets/foo.ext"
  const re = /filePath:\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  for (const m of source.matchAll(re)) out.add(m[1]);
  return [...out];
}

function stubFor(p: string): Buffer {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".html") {
    return Buffer.from("<!doctype html><title>stub</title><h1>CI stub</h1>");
  }
  if (ext === ".csv") {
    return Buffer.from("col1,col2\nstub,stub\n");
  }
  if (ext === ".md") {
    return Buffer.from("# CI stub\n\nThis file is a CI placeholder.\n");
  }
  if (ext === ".pdf") {
    // Minimal valid 1-page PDF
    return Buffer.from(
      "%PDF-1.1\n%\xa1\xb3\xc5\xd7\n1 0 obj<<>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    );
  }
  if (ext === ".json") {
    return Buffer.from('{"stub":true}\n');
  }
  if (ext === ".mp3" || ext === ".mp4" || ext === ".wav") {
    return Buffer.alloc(64); // tiny binary placeholder
  }
  return Buffer.from("CI stub\n");
}

function main() {
  if (!fs.existsSync(CATALOG_SRC)) {
    console.error(`[seed-catalog-files] missing: ${CATALOG_SRC}`);
    process.exit(2);
  }
  const src = fs.readFileSync(CATALOG_SRC, "utf8");
  const paths = extractPaths(src);
  if (!paths.length) {
    console.log("[seed-catalog-files] empty catalog — public mirror has no products to seed (no-op)");
    process.exit(0);
  }
  let created = 0;
  let skipped = 0;
  for (const rel of paths) {
    if (path.isAbsolute(rel)) {
      console.error(`[seed-catalog-files] refuses absolute path in catalog: ${rel}`);
      process.exit(2);
    }
    const abs = path.resolve(ROOT, rel);
    // Use path.relative + ".." check (not startsWith) — sibling-prefix paths
    // like ROOT="/work/repo" + rel="../repo-evil/..." resolve to "/work/repo-evil/..."
    // which falsely passes startsWith("/work/repo"). path.relative correctly
    // produces "../repo-evil/..." starting with "..".
    const relFromRoot = path.relative(ROOT, abs);
    if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
      console.error(`[seed-catalog-files] refuses path outside root: ${rel} → ${relFromRoot}`);
      process.exit(2);
    }
    if (fs.existsSync(abs)) {
      skipped++;
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, stubFor(abs));
    created++;
  }
  console.log(
    `[seed-catalog-files] processed ${paths.length} entries — wrote ${created} stub(s), kept ${skipped} existing`,
  );
}

main();
