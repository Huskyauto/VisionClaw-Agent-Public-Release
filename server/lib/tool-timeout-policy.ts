import { getSlowTools, getVerySlowTools } from "../tool-registry";

export const DEFAULT_TOOL_TIMEOUT_MS = 90_000;
export const SLOW_TOOL_TIMEOUT_MS = 240_000;
export const VERY_SLOW_TOOL_TIMEOUT_MS = 960_000;
const TOOL_WATCHDOG_RECONCILIATION_BUFFER_MS = 60_000;

export function getToolTimeoutMs(name: string): number {
  if (getVerySlowTools().has(name)) return VERY_SLOW_TOOL_TIMEOUT_MS;
  if (getSlowTools().has(name)) return SLOW_TOOL_TIMEOUT_MS;
  return DEFAULT_TOOL_TIMEOUT_MS;
}

export function getToolWatchdogHardCapMs(name: string): number {
  // executeToolWithTimeout permits exactly one reconcile-first retry after the
  // initial attempt times out. The watchdog is observational, so it must not
  // report cancellation while either legitimate attempt is still active.
  return (2 * getToolTimeoutMs(name)) + TOOL_WATCHDOG_RECONCILIATION_BUFFER_MS;
}