import { LocalAdmissionDeferred } from "./local-slots";
export const SURFACE_MODEL = "qwen2.5-7b-instruct-generic-gpu:4";
export type LocalProvider = "surface-local" | "legion-local";
export class SurfaceModelUnavailable extends Error {}
export interface LocalDispatch {
  response: Record<string, any>;
  provider: LocalProvider;
  localFallback: boolean;
}
export type AcceptLocalResponse = (candidate: LocalDispatch) => Promise<void>;
interface Availability {
  assertActive?: () => void;
  surfaceEnabled: () => boolean;
  surfaceHealth: () => Promise<void>;
  legionHealth: () => Promise<void>;
}
interface Dependencies extends Availability {
  preferred?: LocalProvider;
  surfaceGenerate: (body: Record<string, any>) => Promise<Record<string, any>>;
  legionGenerate: (body: Record<string, any>) => Promise<Record<string, any>>;
}

/** Lenovo is always primary. Surface is only an explicitly enabled backup. */
export async function selectLocalBackgroundProvider(deps: Availability): Promise<LocalProvider> {
  deps.assertActive?.();
  try { await deps.legionHealth(); return "legion-local"; }
  catch (error) {
    deps.assertActive?.();
    if (!deps.surfaceEnabled()) throw error;
  }
  await deps.surfaceHealth();
  deps.assertActive?.();
  if (!deps.surfaceEnabled()) throw Error("Surface backup disabled before dispatch");
  return "surface-local";
}

/** Text-only attempts; the native transport acquires each device's own slot. */
export function createLocalBackgroundRouter(deps: Dependencies) {
  return async (body: Record<string, any>, accept?: AcceptLocalResponse): Promise<LocalDispatch> => {
    const preferred = deps.preferred ?? "legion-local";
    const order: LocalProvider[] = preferred === "surface-local" ?
      ["surface-local", "legion-local"] : ["legion-local", "surface-local"];
    let attempted = false;
    let lastError: unknown = Error("No enabled local provider");
    for (const provider of order) {
      if (provider === "surface-local" && !deps.surfaceEnabled()) continue;
      let generating = false;
      try {
        deps.assertActive?.();
        await (provider === "legion-local" ? deps.legionHealth() : deps.surfaceHealth());
        deps.assertActive?.();
        if (provider === "surface-local" && !deps.surfaceEnabled()) throw Error("Surface disabled before dispatch");
        generating = true;
        const candidate: LocalDispatch = {
          response: await (provider === "legion-local" ? deps.legionGenerate(body) : deps.surfaceGenerate({
            model: SURFACE_MODEL, stream: true, temperature: 0, messages: body.messages,
          })), provider, localFallback: provider !== preferred,
        };
        attempted = true;
        await accept?.(candidate);
        return candidate;
      } catch (error) {
        deps.assertActive?.(); // Cancellation/revocation must never trigger fallback.
        // Busy is not a provider failure or permission to spend on hosted rescue.
        // Preserve evidence of an earlier real attempt for queue accounting.
        if (error instanceof LocalAdmissionDeferred) {
          throw new LocalAdmissionDeferred(error.message, attempted || error.generationStarted);
        }
        if (generating) attempted = true; // Includes ambiguous transport failures.
        lastError = error;
        console.warn(`[local-inference] ${provider} attempt rejected; checking remaining permitted route`);
      }
    }
    throw lastError;
  };
}
