/**
 * Render-farm cost guards — PURE, dependency-free so they're unit-testable
 * without loading the heavy farm core (which imports the whole tool registry).
 *
 * Bob 2026-06-02: his one concern about moving all video to the GitHub Actions
 * farm was surprise GitHub bills. These guards bound usage two ways:
 *   - a per-UTC-day render cap (a runaway loop can't silently burn minutes), and
 *   - a max-chapters-per-render cap (one huge script can't fan out unbounded).
 */

export const DEFAULT_DAILY_CAP = 50;
// The CI matrix already bounds num_chapters to 1..24 (bwb-render.yml). This is a
// second, orchestrator-side cap so a single huge script can't fan out unbounded.
export const MAX_CHAPTERS_PER_RENDER = 24;
export const DAILY_CAP_FILE = "data/youtube/.render-farm-daily.json";

/**
 * Decide whether one more render is allowed today and compute the next counter
 * state. Pure: takes prior state + cap + clock, returns the decision. The caller
 * persists `next` only when it dispatches.
 */
export function checkDailyCap(
  prev: { date?: string; count?: number } | null,
  cap: number,
  now: Date = new Date(),
): { allowed: boolean; next: { date: string; count: number }; remaining: number } {
  const today = now.toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const count = prev && prev.date === today ? (prev.count || 0) : 0;
  if (count >= cap) {
    return { allowed: false, next: { date: today, count }, remaining: 0 };
  }
  const next = { date: today, count: count + 1 };
  return { allowed: true, next, remaining: Math.max(0, cap - next.count) };
}

/** Resolve the effective daily cap from env, clamped to a sane minimum. */
export function resolveDailyCap(envValue: string | undefined): number {
  const n = parseInt(envValue || String(DEFAULT_DAILY_CAP), 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_DAILY_CAP;
}
