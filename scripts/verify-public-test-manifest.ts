import path from "node:path";
import fs from "node:fs";
import { pathsForPublicTestCategory, readAndValidatePublicTestManifest, type PublicTestManifest } from "./lib/public-test-classifier";

const args = process.argv.slice(2);
let root = process.cwd();
let category: "ci-runnable" | "database" | "integration" | "browser-or-special" | "manual-source-only" | undefined;
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value || (flag !== "--root" && flag !== "--category")) {
    throw new Error("usage: tsx scripts/verify-public-test-manifest.ts [--root <mirror-root>] [--category <category>]");
  }
  if (flag === "--root") root = path.resolve(value);
  else if (["ci-runnable", "database", "integration", "browser-or-special", "manual-source-only"].includes(value)) category = value as typeof category;
  else throw new Error(`unknown public test category: ${value}`);
}
readAndValidatePublicTestManifest(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "tests/public-test-manifest.json"), "utf8")) as PublicTestManifest;
const counts = Object.fromEntries(manifest.suites.map((suite) => [suite.category, suite.paths.length]));
if (category) {
  process.stdout.write(`${pathsForPublicTestCategory(root, manifest, category).join("\n")}\n`);
} else {
  console.log(`public test manifest is complete: ${root}`);
  console.log(`public test classes: ${Object.entries(counts).map(([name, count]) => `${name}=${count}`).join(", ")}`);
}