/**
 * Simulation Sandbox — side-effect firewall (Slice S1).
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 *
 * Design invariants (do not weaken):
 *
 * 1. ONE chokepoint. The firewall is consulted at the very top of
 *    `executeTool` in server/tools.ts — the single funnel every execution
 *    path passes through (executeGuardedTool and the autonomous step
 *    runners both go through executeToolWithTimeout → executeTool; the
 *    dispatcher/legacy switch sit BELOW executeTool). Placing it anywhere
 *    else creates a bypass class.
 *
 * 2. ALS-only activation. Simulation mode is enabled EXCLUSIVELY via
 *    AsyncLocalStorage (`runInSimulation`) by platform code — never via a
 *    params flag. An LLM (or any caller) cannot forge params to enter OR
 *    exit simulation: there is no param the firewall reads. This mirrors
 *    the tool-abort-context precedent (server/lib/tool-abort-context.ts).
 *
 * 3. Fail CLOSED. In simulation, a tool executes for real ONLY if it is
 *    explicitly classified read-only (tool-mutation.ts READ_ONLY_TOOLS).
 *    Mutating, high-risk, unregistered, and unknown tools are ALL stubbed.
 *    Note: classifyToolRisk defaults unknown tools to "read_only" — that
 *    default is fail-OPEN and therefore deliberately NOT used here; we key
 *    on the explicit allowlist via isExplicitlyReadOnly().
 *
 * 4. Stubs are loud and recorded. Every stubbed call is logged and appended
 *    to the ambient run's `stubbedCalls` so the replay report can show
 *    "would have called X" — the sandbox never silently swallows an action.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { isExplicitlyReadOnly } from "../../tool-mutation";

export interface StubbedCall {
  tool: string;
  /** Small, redacted arg summary — key names + primitive previews only. */
  argsPreview: string;
  at: string; // ISO timestamp
}

export interface SimulationContext {
  /** Correlates to a sandbox_runs row once S2 lands; free-form until then. */
  runId: string;
  stubbedCalls: StubbedCall[];
  /** Real executions permitted (explicit read-only tools). */
  allowedCalls: string[];
}

const simStore = new AsyncLocalStorage<SimulationContext>();

/** Run `fn` with simulation mode active for its entire async subtree. */
export async function runInSimulation<T>(runId: string, fn: () => Promise<T>): Promise<{ result: T; sim: SimulationContext }> {
  const ctx: SimulationContext = { runId, stubbedCalls: [], allowedCalls: [] };
  const result = await simStore.run(ctx, fn);
  return { result, sim: ctx };
}

export function isSimulationActive(): boolean {
  return simStore.getStore() != null;
}

export function getSimulationContext(): SimulationContext | undefined {
  return simStore.getStore();
}

/** Marker so callers/tests can distinguish a stub from a real result. */
export const SIM_STUB_MARKER = "__simulation_stub__";

export interface SimStubResult {
  [SIM_STUB_MARKER]: true;
  simulation: true;
  stubbed: true;
  tool: string;
  success: true;
  note: string;
}

export function isSimStubResult(r: unknown): r is SimStubResult {
  return !!r && typeof r === "object" && (r as any)[SIM_STUB_MARKER] === true;
}

/** Keys whose values must never appear in any form (mirrors the
 * destructive-tool-policy redactor's secret-key convention). */
const SECRET_KEY_RE = /(pass|secret|token|key|credential|auth|bearer|cookie|session|pin|otp|ssn|card|cvv|iban|account)/i;

/**
 * TRUE redaction (architect S1 finding): string values are NEVER included —
 * only key names, types, and lengths. Truncation is not redaction; args can
 * carry secrets, message bodies, emails, card numbers. Numbers/booleans are
 * shown only when the key does not look secret-bearing.
 */
function previewArgs(params: Record<string, any> | null | undefined): string {
  if (!params || typeof params !== "object") return "(no args)";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (parts.length >= 8) { parts.push("…"); break; }
    if (SECRET_KEY_RE.test(k)) parts.push(`${k}=[REDACTED]`);
    else if (v == null) parts.push(`${k}=null`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k}=${v}`);
    else if (typeof v === "string") parts.push(`${k}=<string:${v.length}ch>`);
    else parts.push(`${k}=<${Array.isArray(v) ? `array:${v.length}` : "object"}>`);
  }
  return parts.join(", ").slice(0, 400);
}

/**
 * The chokepoint check. Returns a stub result when the tool must NOT execute
 * under simulation; returns null when execution may proceed (either because
 * simulation is inactive, or the tool is explicitly read-only).
 */
export function maybeStubTool(name: string, params: Record<string, any>): SimStubResult | null {
  const sim = simStore.getStore();
  if (!sim) return null;

  const normalized = String(name || "").trim().toLowerCase();

  // Fail-closed allowlist: ONLY explicit read-only classification passes.
  if (normalized && isExplicitlyReadOnly(normalized)) {
    sim.allowedCalls.push(normalized);
    return null;
  }

  const entry: StubbedCall = {
    tool: normalized || "(empty-name)",
    argsPreview: previewArgs(params),
    at: new Date().toISOString(),
  };
  sim.stubbedCalls.push(entry);
  console.log(`[sim-firewall] STUB run=${sim.runId} tool=${entry.tool} — would have called with: ${entry.argsPreview}`);

  return {
    [SIM_STUB_MARKER]: true,
    simulation: true,
    stubbed: true,
    tool: entry.tool,
    success: true,
    note: `SIMULATION: "${entry.tool}" was stubbed by the sandbox firewall — no real side effects occurred. The call and its arguments were recorded for the replay report.`,
  };
}
