import { LocalAdmissionDeferred } from "./local-slots";
import { LEGION_MODEL, LEGION_REASONING_MODEL } from "./model-policy";
export const SURFACE_MODEL = "qwen2.5-7b-instruct-generic-gpu:4";
export type LocalProvider = "surface-local" | "legion-local";
export class SurfaceModelUnavailable extends Error {}
export interface LocalDispatch {
  response: Record<string, any>;
  provider: LocalProvider;
  localFallback: boolean;
  /** Transport-selected identity, not a claim extracted from generated text. */
  model?: string;
  transport?: "direct" | "spark-relay";
  relayJobId?: number;
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
  legionRetryModels?: readonly string[];
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
        const models = provider === "legion-local"
          ? [body.model, ...(deps.legionRetryModels ?? [])] : [SURFACE_MODEL];
        if (models.length > 2 || models.slice(1).some(model =>
          ![LEGION_MODEL, LEGION_REASONING_MODEL].includes(model)))
          throw Error("Local retry model policy refused");
        for (let attempt = 0; attempt < models.length; attempt++) {
          deps.assertActive?.();
          const request = attempt === 0 ? body : { ...body, model: models[attempt],
            messages: [...body.messages, { role: "system",
              content: "The previous result failed deterministic output validation. Follow the requested schema, labels and source grounding exactly; do not add formatting or invent facts." }] };
          const candidate: LocalDispatch = {
            response: await (provider === "legion-local" ? deps.legionGenerate(request) : deps.surfaceGenerate({
              model: SURFACE_MODEL, stream: true, temperature: 0, messages: body.messages,
            })), provider, localFallback: provider !== preferred, model: models[attempt],
          };
          attempted = true;
          try {
            await accept?.(candidate);
            return candidate;
          } catch (error) {
            deps.assertActive?.();
            if (error instanceof LocalAdmissionDeferred || attempt + 1 >= models.length) throw error;
            console.info(JSON.stringify({ event: "local_validation_retry", provider,
              model: models[attempt], nextModel: models[attempt + 1], attempt: attempt + 1 }));
          }
        }
      } catch (error) {
        deps.assertActive?.(); // Cancellation/revocation must never trigger fallback.
        // A busy primary may use an enabled second device before any generation.
        // Preserve evidence of a real attempt; uncertain work is never refunded.
        if (error instanceof LocalAdmissionDeferred) {
          if (!attempted && !error.generationStarted && provider === "legion-local" && deps.surfaceEnabled()) {
            lastError = error;
            console.info(JSON.stringify({ event: "local_capacity_backup", from: provider, to: "surface-local" }));
            continue;
          }
          throw new LocalAdmissionDeferred(error.message, attempted || error.generationStarted);
        }
        if (generating) attempted = true; // Includes ambiguous transport failures.
        lastError = error;
        console.warn(`[local-inference] ${provider} attempt rejected; checking remaining permitted route`);
      }
    }
    if (!attempted) throw new LocalAdmissionDeferred("No enabled local service has capacity");
    throw lastError;
  };
}
