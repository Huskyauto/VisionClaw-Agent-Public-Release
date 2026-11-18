import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

export const LEGION_RUNBOOKS = [
  ".agents/skills/tdd/SKILL.md", ".agents/skills/zoom-out/SKILL.md",
  ".agents/skills/module-girth-guard/SKILL.md",
] as const;
export class LegionSourceChanged extends Error {}

/** CJS-safe, fixed repository/build sources, never app/customer files. */
export async function readLegionRunbook(sourcePath: string, location: "source" | "staged" =
  process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1" ? "staged" : "source") {
  const index = (LEGION_RUNBOOKS as readonly string[]).indexOf(sourcePath);
  if (index < 0) throw new Error("Legion runbook source refused");
  const path = location === "staged" ? resolve("dist/legion/runbooks", `${index}.md`) : resolve(sourcePath);
  if (await realpath(path) !== path) throw new Error("Legion refuses symlinked runbooks");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (await realpath(`/proc/self/fd/${handle.fd}`) !== path) throw new Error("Legion source identity changed");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 20_000) throw new Error("Legion requires a bounded regular runbook");
    const bytes = Buffer.alloc(20_001);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const text = bytes.subarray(0, bytesRead).toString("utf8");
    if (bytesRead > 20_000 || text.length > 12_000 || text.split("\n").length > 400 ||
        /-----BEGIN [A-Z ]*PRIVATE KEY|(?:sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{30,})|Bearer\s+[a-zA-Z0-9_.-]{20,}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text) ||
        /\b(?:api_?key|password|secret|access_?token|customerEmail|customerPhone)\s*[:=]\s*["'][^"'\n]{8,}["']/i.test(text)) {
      throw new Error("Legion runbook failed its size/sensitive-content screen");
    }
    return { text, sha256: createHash("sha256").update(text).digest("hex") };
  } finally { await handle.close(); }
}

export function stagedRunbookPath(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= LEGION_RUNBOOKS.length) throw new Error("Invalid staged runbook");
  return join("dist/legion/runbooks", `${index}.md`);
}
