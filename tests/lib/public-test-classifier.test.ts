import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPublicTestInventory, validatePublicTestManifest } from "../../scripts/lib/public-test-classifier";

function fixture(paths: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-test-classifier-"));
  for (const file of paths) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "");
  }
  return root;
}

test("accepts a complete, one-suite-per-test manifest", () => {
  const paths = Array.from({ length: 400 }, (_, i) => `tests/nested/${i}.test.ts`);
  const root = fixture(paths);
  assert.doesNotThrow(() => validatePublicTestManifest(root, {
    version: 1,
    minimumTestCount: 400,
    suites: [
      { name: "fast", category: "ci-runnable", paths: paths.slice(0, 10) },
      { name: "nested", category: "integration", paths: paths.slice(10) },
    ],
  }));
});

test("source inventory rejects one deleted test even when the corpus remains above 400", () => {
  const source = fixture(Array.from({ length: 401 }, (_, i) => `tests/${i}.test.ts`));
  const mirror = fixture(Array.from({ length: 400 }, (_, i) => `tests/${i}.test.ts`));
  assert.throws(() => assertPublicTestInventory(source, mirror, []), /inventory differs.*400\.test\.ts/s);
});

test("fails closed for missing, duplicate, unclassified, and collapsed representative corpora", () => {
  const root = fixture(Array.from({ length: 400 }, (_, i) => `tests/${i}.test.ts`));
  assert.throws(() => validatePublicTestManifest(root, {
    version: 1, minimumTestCount: 400, suites: [{ name: "fast", category: "ci-runnable", paths: ["tests/missing.test.ts"] }],
  }), /missing from mirror/);
  assert.throws(() => validatePublicTestManifest(root, {
    version: 1,
    minimumTestCount: 400,
    suites: [{ name: "one", category: "ci-runnable", paths: ["tests/0.test.ts"] }, { name: "two", category: "ci-runnable", paths: ["tests/0.test.ts"] }],
  }), /declared more than once/);
  assert.throws(() => validatePublicTestManifest(root, {
    version: 1, minimumTestCount: 400, suites: [{ name: "fast", category: "ci-runnable", paths: ["tests/0.test.ts"] }],
  }), /not classified/);
  assert.throws(() => validatePublicTestManifest(fixture(["tests/a.test.ts"]), {
    version: 1, minimumTestCount: 400, suites: [{ name: "fast", category: "ci-runnable", paths: ["tests/a.test.ts"] }],
  }), /corpus was collapsed/);
});