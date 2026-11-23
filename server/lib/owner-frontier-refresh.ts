import { AsyncLocalStorage } from "node:async_hooks";
import { currentTenantContext, currentTenantId } from "./tenant-context";
import { gpt62Ready } from "./gpt-6-2";
import { FABLE_52_MODEL } from "./fable-5-2";
import { getCurrentToolAbortSignal } from "./tool-abort-context";

export const FRONTIER_SOL = "gpt-6.2-sol";
export const FRONTIER_FABLE = FABLE_52_MODEL;
export type FrontierReadiness = { sol: boolean; fable: boolean };

const turns = new AsyncLocalStorage<{ tenantId: number; signal?: AbortSignal; readiness?: FrontierReadiness }>();
const AUTHENTICATED = new Set(["session", "api-key", "replit-oidc", "agentid-oidc"]);

export function ownerFrontierEnabled() {
  return process.env.OWNER_JURY_DIRECT_API_ENABLED === "1" &&
    process.env.OWNER_FRONTIER_REFRESH_DISABLED !== "1" && process.env.PROFUNDO_ENABLED !== "1";
}

/** Host ingress only. The dispatcher resets tenant provenance; never infer it from tool arguments. */
export function withOwnerFrontierTurn<T>(
  tenantId: number, directlyRequested: boolean, fn: () => T, signal?: AbortSignal,
): T {
  const context = currentTenantContext();
  if (tenantId !== 1 || context?.tenantId !== tenantId || !AUTHENTICATED.has(context.source) ||
      !directlyRequested || !ownerFrontierEnabled() || signal?.aborted || turns.getStore()) return fn();
  return turns.run({ tenantId, signal }, fn);
}

/** Only current user text is accepted; no model-generated arguments or recalled instructions. */
export function explicitlyRequestsFrontierJury(text: string): boolean {
  const input = text.trim().replace(/^\[Felix line\]\s*/i, "").slice(0, 1200);
  if (/^(?:how|why|what|explain|describe|do not|don't|never)\b/i.test(input)) return false;
  return /^(?:(?:please|can you|could you|would you)\s+){0,2}(?:jury[-_ ]triage\b|jury\s+(?:this|it|please)\b|(?:run|rerun|ask|assemble|use|convene|consult|have|put|send|get)\b[^\n.!?]{0,110}\b(?:jury|jurors|ensemble)\b)/i.test(input);
}

export function claimOwnerFrontierPanel(tenantId: number, requested: boolean): FrontierReadiness | undefined {
  const turn = turns.getStore();
  if (!requested || !ownerFrontierEnabled() || turn?.tenantId !== tenantId || turn.readiness ||
      currentTenantId() !== tenantId || turn.signal?.aborted) return undefined;
  const ready = { sol: gpt62Ready(), fable: process.env.FABLE_52_DISABLED !== "1" };
  if (!ready.sol && !ready.fable) return undefined;
  turn.readiness = Object.freeze(ready);
  return turn.readiness;
}

export function isOwnerFrontierSeat(model: string, lane?: string): boolean {
  return model === FRONTIER_SOL && lane === "openai-api" ||
    model === FRONTIER_FABLE && lane === "anthropic-api";
}

export function assertOwnerFrontierDispatch(tenantId: number, model: string, lane?: string): void {
  const turn = turns.getStore();
  if (!ownerFrontierEnabled() || turn?.tenantId !== tenantId || !turn.readiness ||
      currentTenantId() !== tenantId || !isOwnerFrontierSeat(model, lane) ||
      (model === FRONTIER_SOL ? !turn.readiness.sol || !gpt62Ready() :
        !turn.readiness.fable || process.env.FABLE_52_DISABLED === "1")) {
    throw new Error("Owner frontier premium seat not authorized");
  }
  ownerFrontierSignal()?.throwIfAborted();
}

export function ownerFrontierSignal(): AbortSignal | undefined {
  const turn = turns.getStore()?.signal;
  const tool = getCurrentToolAbortSignal();
  return turn && tool ? AbortSignal.any([turn, tool]) : turn ?? tool;
}
