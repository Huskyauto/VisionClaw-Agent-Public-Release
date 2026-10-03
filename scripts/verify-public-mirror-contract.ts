#!/usr/bin/env tsx
import * as fs from "node:fs";
import * as path from "node:path";
import { compareMirrorContract } from "./lib/public-mirror-contract";

const CONTRACT_MODULES = ["server/product-catalog.ts"];

function fail(message: string, exitCode: 1 | 2): never {
  console.error(`✗ public-mirror contract guard: ${message}`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): { sourceRoot?: string; mirrorRoot?: string } {
  const options: { sourceRoot?: string; mirrorRoot?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--source-root" && flag !== "--mirror-root") {
      fail(`unknown argument "${flag}"`, 2);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${flag} requires a directory`, 2);
    }
    const key = flag === "--source-root" ? "sourceRoot" : "mirrorRoot";
    if (options[key]) {
      fail(`${flag} was provided more than once`, 2);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isReadableFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

const options = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(options.sourceRoot ?? process.cwd());
const mirrorRoot = path.resolve(options.mirrorRoot ?? path.join(sourceRoot, "public-mirror"));

if (!isDirectory(sourceRoot)) fail(`source root is not a readable directory: ${sourceRoot}`, 1);
if (!isDirectory(mirrorRoot)) fail(`mirror root is not a readable directory: ${mirrorRoot}`, 1);

for (const modulePath of CONTRACT_MODULES) {
  const sourcePath = path.join(sourceRoot, modulePath);
  const mirrorPath = path.join(mirrorRoot, modulePath);
  if (!isReadableFile(sourcePath) || !isReadableFile(mirrorPath)) {
    fail(`missing or unreadable module file: ${!isReadableFile(sourcePath) ? sourcePath : mirrorPath} (fail closed)`, 1);
  }
  let privateSource: string;
  let mirrorSource: string;
  try {
    privateSource = fs.readFileSync(sourcePath, "utf8");
    mirrorSource = fs.readFileSync(mirrorPath, "utf8");
  } catch (error) {
    fail(`could not read module contract inputs: ${(error as Error).message}`, 1);
  }
  const result = compareMirrorContract(
    privateSource,
    mirrorSource,
    modulePath,
  );
  if (!result.ok) {
    console.error(`✗ public-mirror contract guard: ${result.message}`);
    process.exit(1);
  }
  console.log(`✓ public-mirror contract guard: ${result.message}`);
}