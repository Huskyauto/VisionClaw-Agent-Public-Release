import { LocalAdmissionDeferred } from "./local-slots";
import type { LocalDispatch, AcceptLocalResponse } from "./local-router";
import { SPARK_RELAY } from "./spark-relay-contract";

interface Dependencies {
  directHealth(): Promise<void>;
  directGenerate(body: Record<string, any>): Promise<Record<string, any>>;
  relayAvailable(): Promise<boolean>;
  retainedRelay?(): Promise<boolean>;
  relayGenerate(body: Record<string, any>): Promise<{ response: Record<string, any>; relayJobId: number }>;
  assertActive(): void;
  eligible: boolean;
}
/** Choose transport before generation; never retry an ambiguous direct call. */
export function createSparkFallback(deps: Dependencies) {
  let relay = false;
  let relayJobId: number | undefined;
  return {
    async health() {
      deps.assertActive();
      relay = false;
      if (deps.eligible) {
        let retained = false;
        try { retained = await deps.retainedRelay?.() ?? false; }
        catch { throw new LocalAdmissionDeferred("Retained Lenovo work cannot be reconciled", true); }
        if (retained) { deps.assertActive(); relay = true; return; }
      }
      try { await deps.directHealth(); }
      catch (error) {
        deps.assertActive();
        if (!deps.eligible || !(await deps.relayAvailable())) throw error;
        deps.assertActive();
        relay = true;
      }
    },
    async generate(body: Record<string, any>) {
      deps.assertActive();
      if (relay) {
        if (body.model !== SPARK_RELAY.model) throw new LocalAdmissionDeferred("Spark relay model refused", true);
        let result: Awaited<ReturnType<Dependencies["relayGenerate"]>>;
        try { result = await deps.relayGenerate(body); }
        catch (error) {
          if (error instanceof LocalAdmissionDeferred) throw error;
          throw new LocalAdmissionDeferred("Spark relay dispatch outcome uncertain; no transport retry", true);
        }
        relayJobId = result.relayJobId;
        return result.response;
      }
      return deps.directGenerate(body);
    },
    async accept(candidate: LocalDispatch, accept: AcceptLocalResponse) {
      if (candidate.provider === "legion-local") {
        candidate.transport = relay ? "spark-relay" : "direct";
        candidate.relayJobId = relayJobId;
      }
      try { await accept(candidate); }
      catch (error) {
        if (relay && candidate.provider === "legion-local")
          throw new LocalAdmissionDeferred("Spark relay output rejected; no transport retry", true);
        throw error;
      }
    },
  };
}
