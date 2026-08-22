import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, "server");
const STORAGE_FILE = path.join(SERVER_DIR, "storage.ts");

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

test("all runtime skills-table mutations use the validated storage boundary", () => {
  const bypasses = listTypeScriptFiles(SERVER_DIR)
    .filter(file => file !== STORAGE_FILE)
    .filter(file => {
      const source = fs.readFileSync(file, "utf8");
      return /\b(?:db|tx)\.(?:insert|update|delete)\(skills\)/.test(source)
        || /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+skills\b/i.test(source);
    })
    .map(file => path.relative(ROOT, file));

  assert.deepEqual(bypasses, []);
});

test("managed skill updates lock, merge, and validate before persistence", () => {
  const source = fs.readFileSync(STORAGE_FILE, "utf8");
  assert.match(source, /\.for\("update"\)/);
  assert.match(
    source,
    /assertManagedSkillRecordSafe\(\{\s*\.\.\.existing,\s*\.\.\.data\s*\}\)[\s\S]*update\(skills\)/,
  );
});