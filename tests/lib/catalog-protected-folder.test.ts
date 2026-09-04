/**
 * Task 78 — Catch a new product file being added outside the protected folder.
 *
 * Task #77 moved every static product file into the committed
 * `project-assets/catalog/` directory (gitignored `project-assets/` and
 * ephemeral `uploads/` don't survive a publish — the Productivity Bundle
 * quickstart PDF once vanished that way). Nothing in the type system stops a
 * future catalog entry from pointing back outside the protected folder, so
 * this test statically extracts every `filePath:` literal from
 * `server/product-catalog.ts` (primary + additionalFiles — the same regex the
 * CI stub seeder in tests/fixtures/seed-catalog-files.ts uses) and fails if
 * any resolves outside `project-assets/catalog/`.
 *
 * Static parse (not import) on purpose: importing the module isn't needed,
 * and lookupProduct() does fs existence checks that make the test depend on
 * on-disk payloads instead of the invariant under test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const CATALOG_SRC = path.join(ROOT, "server/product-catalog.ts");
const PROTECTED_DIR = "project-assets/catalog";

function extractFilePaths(source: string): string[] {
  const re = /filePath:\s*['"]([^'"]+)['"]/g;
  const out: string[] = [];
  for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

test("catalog source exists and contains static filePath entries", () => {
  assert.ok(fs.existsSync(CATALOG_SRC), `missing ${CATALOG_SRC}`);
  const src = fs.readFileSync(CATALOG_SRC, "utf8");
  const paths = extractFilePaths(src);
  // Fail closed: zero matches means the catalog format changed and this
  // guard (plus the CI seeder that shares the regex) silently went blind.
  assert.ok(
    paths.length > 0,
    "no filePath: entries found in server/product-catalog.ts — catalog format changed? Update this test AND tests/fixtures/seed-catalog-files.ts",
  );
});

test("every static catalog filePath lives under project-assets/catalog/", () => {
  const src = fs.readFileSync(CATALOG_SRC, "utf8");
  const offenders: string[] = [];
  for (const rel of extractFilePaths(src)) {
    if (path.isAbsolute(rel)) {
      offenders.push(`${rel} (absolute path)`);
      continue;
    }
    // Normalize to defeat ../ tricks and sibling-prefix names like
    // "project-assets/catalog-evil/x" — require containment via path.relative.
    const abs = path.resolve(ROOT, rel);
    const fromProtected = path.relative(path.resolve(ROOT, PROTECTED_DIR), abs);
    if (fromProtected.startsWith("..") || path.isAbsolute(fromProtected)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `static product filePath(s) outside ${PROTECTED_DIR}/ — files there vanish on workspace loss/publish:\n  ${offenders.join("\n  ")}`,
  );
});
