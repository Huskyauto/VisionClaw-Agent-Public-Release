import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * esbuild bundles typescript.js into the verifier child. Its default library
 * lookup then resolves beside that bundle, not in node_modules (which can be
 * pruned in production). Ship the matching declaration libraries there too.
 */
export async function stageTypeScriptStandardLibraries(outputDir: string): Promise<number> {
  const require = createRequire(import.meta.url);
  const libraryDir = dirname(require.resolve("typescript"));
  const libraries = (await readdir(libraryDir))
    .filter((name) => name.startsWith("lib.") && name.endsWith(".d.ts"));
  for (const required of ["lib.d.ts", "lib.dom.d.ts", "lib.esnext.d.ts", "lib.decorators.d.ts"]) {
    if (!libraries.includes(required)) throw new Error(`TypeScript library missing: ${required}`);
  }
  await mkdir(outputDir, { recursive: true });
  for (const name of libraries) {
    await copyFile(join(libraryDir, name), join(outputDir, name));
  }
  return libraries.length;
}