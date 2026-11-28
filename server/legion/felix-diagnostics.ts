import { LEGION_MODEL } from "./model-policy";
import { randomUUID } from "node:crypto";

interface Dependencies {
  enabled(): boolean;
  status(signal: AbortSignal): Promise<{ modelAvailable: boolean; transportReady?: boolean }>;
  infer(signal: AbortSignal): Promise<{ content: string; rawOutput?: string; model: string; latencyMs: number;
    usageLedgerConfirmed?: boolean }>;
  record(receipt: Record<string, unknown>): Promise<number>;
}

/** Fixed synthetic diagnostics only; never an arbitrary-prompt local gateway. */
export function createLegionDiagnostics(deps: Dependencies) {
  return async (input: unknown, context: { tenantId?: number; personaId?: number; conversationId?: number }): Promise<Record<string, any>> => {
    if (context.tenantId !== 1 || context.personaId !== 2)
      return { status: "forbidden", error: "Legion diagnostics require owner-tenant Felix." };
    const value = input as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some(key => !["provider", "local_check"].includes(key)) ||
        value.provider !== "legion-local" ||
        (value.local_check !== undefined &&
          (typeof value.local_check !== "string" || !["status", "arithmetic"].includes(value.local_check))))
      return { status: "invalid_request", error: "Use provider legion-local and local_check status or arithmetic. No prompts or URLs accepted." };
    const base = { provider: "legion-local", configuredModel: LEGION_MODEL,
      servedModel: null, hostedFallback: false, tailscaleNodeStatus: "not_exposed" };
    if (!deps.enabled()) return { ...base, status: "disabled" };
    let modelAvailable: boolean;
    let transportReady: boolean;
    try {
      const health = await deps.status(AbortSignal.timeout(5_000));
      modelAvailable = health.modelAvailable === true;
      transportReady = health.transportReady === true;
    } catch {
      return { ...base, status: "unavailable", error: "Legion private transport did not confirm the required model. No cloud fallback used." };
    }
    if (value.local_check !== "arithmetic" || !modelAvailable)
      return { ...base, modelAvailable, transportReady, status: modelAvailable ? "available" : "model_unavailable" };
    if (!transportReady)
      return { ...base, modelAvailable, transportReady, status: "transport_not_ready",
        error: "The required model responded, but supervised private transport readiness is not confirmed. No generation started." };
    const probeId = randomUUID();
    let result: Awaited<ReturnType<Dependencies["infer"]>>;
    try {
      result = await deps.infer(AbortSignal.timeout(30_000));
      if (result.model !== `legion-local:${LEGION_MODEL}` ||
          typeof result.content !== "string" || result.content.trim() !== "42" ||
          typeof result.rawOutput !== "string" || result.rawOutput.trim() !== "42" || result.rawOutput.length > 200 ||
          !Number.isFinite(result.latencyMs) || result.latencyMs < 0)
        throw Error("Unverified synthetic completion");
    } catch {
      return { ...base, probeId, status: "check_failed",
        error: "No validated Mellum arithmetic completion was confirmed. Do not retry automatically; no cloud fallback used." };
    }
    const receipt = { probeId, provider: "legion-local", servedModel: LEGION_MODEL,
      ...(Number.isSafeInteger(context.conversationId) && context.conversationId! > 0
        ? { conversationId: context.conversationId } : {}),
      rawOutput: result.rawOutput, latencyMs: result.latencyMs,
      latencyScope: "local_worker_including_admission_and_accounting",
      usageLedgerConfirmed: result.usageLedgerConfirmed === true,
      providerReportedCostUsd: null, meteredCloudCostUsd: 0, hostedFallback: false,
      prompt: "What is 17 + 25? Reply with only the number.", expectedOutput: "42" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const id = await Promise.race([deps.record(receipt), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("Receipt deadline")), 5_000);
      })]);
      if (!Number.isSafeInteger(id) || id <= 0) throw Error("Receipt was not confirmed");
      return { ...base, ...receipt, status: "complete", receipt: { type: "activity_log", id, probeId } };
    } catch {
      return { ...base, probeId, status: "receipt_unconfirmed", generationCompleted: true,
        error: "Local generation returned, but its durable receipt was not confirmed. Do not retry automatically or claim recorded acceptance." };
    } finally { if (timer) clearTimeout(timer); }
  };
}
