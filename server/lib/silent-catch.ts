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
 * Categories (code-review round 2, finding #5): a swallow is either
 *  - "expected"   — an optional/cleanup path that is ALLOWED to fail (ENOENT on
 *                   unlink, best-effort cache warmup, optional integration). These
 *                   are counted but never logged, even with logging enabled, so
 *                   they don't drown the signal.
 *  - "unexpected" — the default. A swallow that *should* normally succeed; a
 *                   spike here is a real regression. Logged (when enabled) AND
 *                   counted so it can be alerted on.
 *
 * Both categories increment an in-memory counter regardless of NODE_ENV, so the
 * fallback is *measurable in production* (where logging is off) — surface
 * getSilentCatchStats() on an admin/health route to turn the swallows into a
 * triageable, alertable stream instead of a log grep.
 *
 * The codemod can be re-run safely; the regression test in
 * tests/safety/no-silent-catch.test.ts blocks new empty catches from landing.
 */
const enabled =
  process.env.NODE_ENV !== "production" || process.env.LOG_SILENT_CATCHES === "1";

export type SilentCatchCategory = "expected" | "unexpected";

const counts = new Map<string, number>();

export function logSilentCatch(
  site: string,
  err: unknown,
  category: SilentCatchCategory = "unexpected",
): void {
  // Count always — even in production where logging is off — so the rate of
  // swallowed errors is observable rather than invisible.
  const key = `${category}:${site}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);

  if (!enabled) return;
  // "expected" swallows are known-benign; count but stay quiet so they don't
  // bury the genuine regressions in the "unexpected" stream.
  if (category === "expected") return;
  const msg = (err as any)?.message ?? err;
  console.warn(`[silent-catch] ${site}:`, msg);
}

/**
 * Snapshot of swallow counts keyed by `${category}:${site}`. Cheap to call;
 * intended for an admin/health endpoint or the ecosystem-health dashboard.
 */
export function getSilentCatchStats(): Record<string, number> {
  return Object.fromEntries(counts);
}

/** Reset the in-memory counters (primarily for tests). */
export function resetSilentCatchStats(): void {
  counts.clear();
}
