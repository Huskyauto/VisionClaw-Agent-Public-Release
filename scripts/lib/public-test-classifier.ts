import fs from "node:fs";
import path from "node:path";

export interface PublicTestSuite {
  name: string;
  category: "ci-runnable" | "database" | "integration" | "browser-or-special" | "manual-source-only";
  paths: string[];
}

export interface PublicTestManifest {
  version: 1;
  minimumTestCount: number;
  suites: PublicTestSuite[];
}

function findTests(root: string, directory = "tests"): string[] {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  const entries = fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return entries.flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(root, relative);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [relative] : [];
  });
}

export function assertPublicTestInventory(sourceRoot: string, mirrorRoot: string, exclusions: readonly string[]): void {
  const excluded = new Set(exclusions);
  const expected = findTests(sourceRoot).filter((test) => !excluded.has(test));
  const actual = findTests(mirrorRoot);
  const missing = expected.filter((test) => !actual.includes(test));
  const unexpected = actual.filter((test) => !expected.includes(test));
  if (missing.length || unexpected.length) {
    throw new Error(`public test inventory differs from source (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`);
  }
}

function normalizeManifestPath(value: string): string {
  if (!value || path.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`invalid manifest test path: ${JSON.stringify(value)}`);
  }
  return value.replace(/^\.\//, "");
}

export function validatePublicTestManifest(root: string, manifest: PublicTestManifest): void {
  if (manifest.version !== 1 || !Number.isInteger(manifest.minimumTestCount) || manifest.minimumTestCount < 20 ||
      !Array.isArray(manifest.suites) || manifest.suites.length === 0) {
    throw new Error("manifest must declare version 1, a minimum corpus of at least 20 tests, and at least one suite");
  }

  const shipped = new Set(findTests(root));
  if (shipped.size < manifest.minimumTestCount) {
    throw new Error(`public test corpus was collapsed: shipped ${shipped.size}, minimum ${manifest.minimumTestCount}`);
  }
  const declared = new Map<string, string>();
  for (const suite of manifest.suites) {
    if (!suite.name || !["ci-runnable", "database", "integration", "browser-or-special", "manual-source-only"].includes(suite.category) ||
        !Array.isArray(suite.paths) || suite.paths.length === 0) {
      throw new Error("every declared suite must have a name, valid category, and at least one path");
    }
    for (const rawPath of suite.paths) {
      const testPath = normalizeManifestPath(rawPath);
      if (declared.has(testPath)) {
        throw new Error(`test is declared more than once: ${testPath} (${declared.get(testPath)}, ${suite.name})`);
      }
      declared.set(testPath, suite.name);
      if (!shipped.has(testPath)) throw new Error(`manifest path is missing from mirror: ${testPath}`);
    }
  }

  for (const testPath of shipped) {
    if (!declared.has(testPath)) throw new Error(`shipped test is not classified: ${testPath}`);
  }
}

export function pathsForPublicTestCategory(root: string, manifest: PublicTestManifest, category: PublicTestSuite["category"]): string[] {
  validatePublicTestManifest(root, manifest);
  return manifest.suites.filter((suite) => suite.category === category).flatMap((suite) => suite.paths);
}

export function readAndValidatePublicTestManifest(root: string): void {
  const manifestPath = path.join(root, "tests/public-test-manifest.json");
  let manifest: PublicTestManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PublicTestManifest;
  } catch (error) {
    throw new Error(`cannot read public test manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  validatePublicTestManifest(root, manifest);
}