/**
 * Tools-layer-split S4 — legacy-switch injection slot.
 *
 * This is a THIN WRAPPER around the monolith's switch, NOT a copy (plan.md
 * S4). The acyclicity invariant forbids this package from importing
 * `server/tools.ts`, so the monolith injects its own switch function here at
 * module load (`setLegacyExecutor(_legacySwitchExec)` in server/tools.ts).
 * The dispatcher falls back to this executor for every unmigrated tool.
 *
 * The legacy executor receives the ORIGINAL params object — including the
 * platform-stamped trust signals (`_tenantId`, `_rateLimitChecked`, …) —
 * because the legacy arms read them directly. Stripping happens ONLY on the
 * migrated-handler path (see dispatcher.ts). Zero behavior change for
 * unmigrated tools.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export type LegacyExecutor = (
  name: string,
  params: Record<string, any>,
) => Promise<any>;

let legacyExecutor: LegacyExecutor | undefined;

/** Called exactly once, at module load, by server/tools.ts. */
export function setLegacyExecutor(fn: LegacyExecutor): void {
  legacyExecutor = fn;
}

export function getLegacyExecutor(): LegacyExecutor | undefined {
  return legacyExecutor;
}
