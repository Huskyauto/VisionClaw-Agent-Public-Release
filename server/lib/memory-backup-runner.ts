import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Production must not start the source-only tsx loader or install via npx. */
export function memoryBackupCommand(options: {
  production: boolean;
  cwd?: string;
  node?: string;
  exists?: (path: string) => boolean;
}): { command: string; args: string[] } {
  if (!options.production) return { command: "npx", args: ["tsx", "scripts/nightly-memory-backup.ts"] };
  const bundle = resolve(options.cwd ?? process.cwd(), "dist/nightly-memory-backup.cjs");
  if (!(options.exists ?? existsSync)(bundle)) throw new Error("Production memory backup bundle missing; rebuild and republish");
  return { command: options.node ?? process.execPath, args: [bundle] };
}
