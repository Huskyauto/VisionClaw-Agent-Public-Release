import { legionBackgroundEnabled, legionProxyPort } from "./runtime";
import { legionRequest } from "./proxy-client";
import { surfaceRequest } from "./surface-client";
import { createLocalBackgroundRouter, selectLocalBackgroundProvider, SURFACE_MODEL, type AcceptLocalResponse } from "./local-router";
import { localParallelEnabled, withLocalInferenceSlot } from "./local-slots";

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
    legionHealth: () => checkLegionHealth(signal),
  });
}

export function dispatchLocalBackground(body: Record<string, any>, signal: AbortSignal, accept: AcceptLocalResponse,
  task = "compile-runbook") {
  const simple = localParallelEnabled() && task === "extract-runbook-rule";
  return createLocalBackgroundRouter({
    preferred: simple ? "surface-local" : "legion-local",
    assertActive: () => {
      signal.throwIfAborted();
      if (!legionBackgroundEnabled()) throw Error("Local background disabled");
    },
    surfaceEnabled: () => surfaceLocalEnabled() && (!localParallelEnabled() || simple),
    surfaceHealth: () => checkSurfaceHealth(signal),
    surfaceGenerate: value => {
      signal.throwIfAborted();
      if (!surfaceLocalEnabled()) throw Error("Surface disabled before dispatch");
      return withLocalInferenceSlot("surface-local", signal, active =>
        surfaceRequest(legionProxyPort(), "/v1/chat/completions", value, 90_000, active));
    },
    legionHealth: () => checkLegionHealth(signal),
    legionGenerate: value => {
      signal.throwIfAborted();
      if (!legionBackgroundEnabled()) throw Error("Local background disabled before dispatch");
      return withLocalInferenceSlot("legion-local", signal, active =>
        legionRequest(legionProxyPort(), "/v1/chat/completions", value, 90_000, active));
    },
  })(body, accept);
}
