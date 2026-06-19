/**
 * Centralized handler for previously-silent catch blocks.
 *
 * Background: 448 empty catch blocks across server/ were swallowing
 * errors silently (e.g. the projects-click 500 stayed invisible until a user
 * reported it). The codemod in scripts/seal-silent-catches.mjs converted them
 * to call this helper.
 *
 * Behavior:
 *  - In development / tests: emits a console.warn so hidden bugs surface.
 *  - In production: stays silent by default (matching the original behavior),
 *    so benign cleanup paths (ENOENT on temp-file unlink, etc.) don't flood
 *    logs. Set LOG_SILENT_CATCHES=1 to re-enable for debugging.
 *
 * The codemod can be re-run safely; the regression test in
 * tests/safety/no-silent-catch.test.ts blocks new empty catches from landing.
 */
const enabled =
  process.env.NODE_ENV !== "production" || process.env.LOG_SILENT_CATCHES === "1";

export function logSilentCatch(site: string, err: unknown): void {
  if (!enabled) return;
  const msg = (err as any)?.message ?? err;
  console.warn(`[silent-catch] ${site}:`, msg);
}
