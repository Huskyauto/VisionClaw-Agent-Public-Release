import { legionBackgroundEnabled, legionProxyPort } from "./runtime";
import { legionRequest } from "./proxy-client";
import { surfaceRequest } from "./surface-client";
import { createLocalBackgroundRouter, selectLocalBackgroundProvider, SURFACE_MODEL, type AcceptLocalResponse } from "./local-router";
import { localParallelEnabled, withLocalInferenceSlot } from "./local-slots";
import { localMemoryTaskPolicy } from "./memory-tasks";
import { LEGION_MODEL, LEGION_REASONING_MODEL } from "./model-policy";
import { randomUUID } from "node:crypto";
import { createSparkFallback } from "./spark-relay-fallback";
import { sparkRelayAvailable, currentSparkRelayWork, requestSparkRelay, sparkRelayStore } from "./spark-relay-runtime";

// Exact owner opt-in. No new credential or daemon.
export const surfaceLocalEnabled = () =>
  legionBackgroundEnabled() && process.env.SURFACE_LOCAL_ENABLED === "1";

export async function checkSurfaceHealth(signal?: AbortSignal) {
  const catalog = await surfaceRequest(legionProxyPort(), "/v1/models", undefined, 2500, signal);
  if (!Array.isArray(catalog.data) || !catalog.data.some(model => model?.id === SURFACE_MODEL)) {
    throw Error("Surface required model unavailable");
  }
}
async function checkLegionHealth(signal?: AbortSignal) {
  const version = await legionRequest(legionProxyPort(), "/api/version", undefined, 2500, signal);
  if (typeof version.version !== "string") throw Error("Lenovo health unavailable");
}

/** Used by the existing queue's pre-generation wait gate; never loads models. */
export async function checkLocalCapacity(signal?: AbortSignal, simple = false) {
  await selectLocalBackgroundProvider({
    surfaceEnabled: () => surfaceLocalEnabled() && (!localParallelEnabled() || simple),
    surfaceHealth: () => { signal?.throwIfAborted(); return checkSurfaceHealth(signal); },
    legionHealth: async () => {
      try { await checkLegionHealth(signal); }
      catch (error) {
        signal?.throwIfAborted();
        if (!(await sparkRelayAvailable())) throw error;
      }
    },
  });
}

export function dispatchLocalBackground(body: Record<string, any>, signal: AbortSignal, accept: AcceptLocalResponse,
  task = "compile-runbook") {
  const memoryPolicy = localMemoryTaskPolicy(task);
  const simple = localParallelEnabled() && (task === "extract-runbook-rule" || memoryPolicy?.simple === true);
  const assertActive = () => {
    signal.throwIfAborted();
    if (!legionBackgroundEnabled()) throw Error("Local background disabled");
    if (task.startsWith("routine-") && (process.env.LEGION_ROUTINE_ENABLED !== "1" ||
        process.env.APP_ACCESS_MODE !== "owner-only")) throw Error("Routine local routing disabled");
  };
  const workId = currentSparkRelayWork() ?? randomUUID();
  const transport = createSparkFallback({
    assertActive,
    eligible: ["compile-runbook", "extract-runbook-rule"].includes(task),
    directHealth: () => checkLegionHealth(signal),
    relayAvailable: sparkRelayAvailable,
    retainedRelay: async () => currentSparkRelayWork() !== undefined &&
      !!(await sparkRelayStore.find(1, body, task, workId)),
    relayGenerate: value => requestSparkRelay(value, signal, task, workId),
    directGenerate: value => withLocalInferenceSlot("legion-local", signal, active =>
      legionRequest(legionProxyPort(), "/v1/chat/completions", value, memoryPolicy ? 45_000 : 90_000, active)),
  });
  return createLocalBackgroundRouter({
    preferred: "legion-local",
    legionRetryModels: [task === "dream-proposals" ? LEGION_REASONING_MODEL : LEGION_MODEL],
    assertActive,
    surfaceEnabled: () => surfaceLocalEnabled() &&
      (memoryPolicy ? memoryPolicy.simple : (!localParallelEnabled() || simple)),
    surfaceHealth: () => checkSurfaceHealth(signal),
    surfaceGenerate: value => {
      signal.throwIfAborted();
      if (!surfaceLocalEnabled()) throw Error("Surface disabled before dispatch");
      return withLocalInferenceSlot("surface-local", signal, active =>
        surfaceRequest(legionProxyPort(), "/v1/chat/completions", value, memoryPolicy ? 35_000 : 90_000, active));
    },
    legionHealth: transport.health,
    legionGenerate: transport.generate,
  })(body, candidate => transport.accept(candidate, accept));
}
