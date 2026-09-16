import * as path from "node:path";
import { existsSyncEIO } from "./eio-read";

/**
 * Resolve how to run one of the BWB weekly-recap chain scripts as a child
 * process.
 *
 * The chain spawns several TypeScript scripts in sequence
 * (bwb_weekly_build → bwb-weekly-orchestrator → build-bwb-weekly →
 * bwb-render-github | build-bwb-video). In DEVELOPMENT we run them straight from
 * source with `npx tsx`. In PRODUCTION that path is fundamentally broken: a
 * `npx tsx <script>.ts` child spawn dies at load with `ERR_MODULE_NOT_FOUND`
 * for `tsx/node_modules/esbuild` — before any script code runs — even though
 * `tsx` and `esbuild` are declared in package.json `dependencies`. The exact
 * cause was not pinned down (a missing platform-specific esbuild binary,
 * nested-module resolution, or deploy-time omission); what's certain is the
 * failure is deterministic and PROD-ONLY — the tsx loader cannot start in the
 * deployed image. This is what surfaced as "weekly recap orchestrator exited
 * early (code 1) ... after 4 startup attempts": every spawn attempt hit the
 * same deterministic resolver failure (NOT a transient overlayFS EIO).
 *
 * The fix mirrors how the server itself ships: `scripts/build.ts` pre-bundles
 * each chain script to `dist/<name>.cjs`, and in prod we run the bundle with
 * plain `node` (no tsx, no runtime esbuild). Pass the source-relative path
 * (e.g. "scripts/build-bwb-weekly.ts"); returns the {cmd, args} to hand to
 * spawn / spawnSync.
 *
 * Falls back to `npx tsx <script>.ts` whenever the bundle is absent (dev, or a
 * prod image built before this change) so behaviour degrades to the previous
 * path rather than hard-failing on a missing file.
 */
export function bwbScriptCommand(scriptRelPath: string): { cmd: string; args: string[] } {
  const base = path.basename(scriptRelPath).replace(/\.[cm]?ts$/, "");
  const isProd =
    process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";
  if (isProd) {
    const bundled = path.join(process.cwd(), "dist", `${base}.cjs`);
    // EIO-aware existence probe: a transient overlayFS read fault on the bare
    // fs.existsSync would return false and degrade us to the deterministically-
    // broken `npx tsx` prod path (see header). existsSyncEIO retries on transient
    // EIO; on a PERSISTENT EIO it throws — in which case we still prefer the
    // bundle (`node dist/*.cjs`), because the tsx loader is known-broken in prod
    // and is never the safer fallback.
    let exists = true;
    try {
      exists = existsSyncEIO(bundled);
    } catch {
      exists = true;
    }
    if (exists) return { cmd: "node", args: [bundled] };
  }
  return { cmd: "npx", args: ["tsx", scriptRelPath] };
}
