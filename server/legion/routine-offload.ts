import type { RoutineContract } from "./routine-contract";
import { validateRoutineOutput } from "./routine-contract";

export interface RoutineWork {
  tenantId: number;
  task: "routine-summary" | "routine-extraction" | "routine-classification" | "routine-transform" | "routine-draft" | "routine-exact";
  messages: { role: "system" | "user"; content: string }[];
  contract: RoutineContract;
  explicitCloud?: boolean;
  signal?: AbortSignal;
  conversationId?: number;
}
interface Dependencies {
  enabled(): boolean;
  trustedTenant(): number | null;
  shutdownSignal?(): AbortSignal;
  run(work: { tenantId: number; task: RoutineWork["task"]; messages: RoutineWork["messages"];
    signal: AbortSignal; validateContent(text: string): void }): Promise<{ content: string; model: string }>;
  event(value: Record<string, unknown>): void;
}

/** Local inference only. The supplied original cloud closure retains all its gates. */
export function createRoutineOffload(deps: Dependencies) {
  return async (work: RoutineWork, originalCloud: () => Promise<string>): Promise<string> => {
    const shutdown = deps.shutdownSignal?.();
    const external = AbortSignal.any([...(work.signal ? [work.signal] : []), ...(shutdown ? [shutdown] : [])]);
    external.throwIfAborted();
    const trusted = deps.trustedTenant();
    if (!Number.isSafeInteger(work.tenantId) || work.tenantId <= 0 ||
        (trusted !== null && trusted !== work.tenantId)) throw Error("Routine workload tenant mismatch");
    const allowed = () => deps.enabled() && work.tenantId === 1 &&
      (deps.trustedTenant() === null || deps.trustedTenant() === 1);
    if (work.explicitCloud || !allowed()) return originalCloud();
    const started = Date.now();
    const abort = new AbortController();
    const active = AbortSignal.any([abort.signal, external]);
    const emit = (status: string, model?: string) => {
      try {
        deps.event({ event: "local_routine_result", task: work.task, tenantId: 1,
          conversationId: Number.isSafeInteger(work.conversationId) ? work.conversationId : null,
          model: model ?? null, status, latencyMs: Date.now() - started,
          cloudCallsAvoided: status === "accepted" ? 1 : 0, fallback: status === "accepted" ? "none" : "original-cloud" });
      } catch { console.warn("[local-routine] telemetry unavailable"); }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        deps.run({ tenantId: 1, task: work.task, messages: work.messages, signal: active,
          validateContent: text => { validateRoutineOutput(text, work.contract); } }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(Error("Local routine deadline")); }, 30_000);
        }),
      ]);
      active.throwIfAborted();
      if (!allowed()) throw Error("Local routing disabled before acceptance");
      validateRoutineOutput(result.content, work.contract);
      emit("accepted", result.model);
      return result.content.trim();
    } catch {
      external.throwIfAborted(); // Caller or supervisor cancellation never authorizes cloud work.
      if (deps.trustedTenant() !== null && deps.trustedTenant() !== work.tenantId)
        throw Error("Routine tenant context changed");
      emit("fallback");
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
    }
    external.throwIfAborted();
    return originalCloud();
  };
}
