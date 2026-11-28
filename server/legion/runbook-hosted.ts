import { currentTenantId, withTenantContext } from "../lib/tenant-context";
import { legionBackgroundEnabled, legionShutdownSignal } from "./runtime";

export const localHostedFallbackEnabled = () =>
  legionBackgroundEnabled() && process.env.LOCAL_HOSTED_FALLBACK_ENABLED === "1";

/** Waiting is refundable capacity only if no local or hosted generation began. */
export class HostedRunbookWaiting extends Error {
  constructor(message: string, readonly generationStarted = false) { super(message); }
}

export function assertRunbookActive() {
  legionShutdownSignal().throwIfAborted();
  if (!legionBackgroundEnabled() || (currentTenantId() !== null && currentTenantId() !== 1)) {
    throw Error("Runbook owner/background scope refused");
  }
}

type Messages = { role: "system" | "user"; content: string }[];
interface HostedDependencies {
  assertActive(): void;
  resolve(): Promise<{ model: string; generate(messages: Messages, signal: AbortSignal): Promise<Record<string, any>> }>;
  claim(model: string): Promise<boolean>;
}

/** One hosted submission; no unbounded retry or bypass of normal provider policy. */
export function createHostedRunbookGenerator(deps: HostedDependencies) {
  return async (messages: Messages, taskSignal?: AbortSignal) => {
    deps.assertActive();
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 3 ||
        messages.some(m => !m || !["system", "user"].includes(m.role) || typeof m.content !== "string") ||
        messages.reduce((n, m) => n + m.content.length, 0) > 12_000) {
      throw Error("Hosted runbook input scope refused");
    }
    const abort = new AbortController();
    const parent = legionShutdownSignal();
    const signal = AbortSignal.any([parent, abort.signal, ...(taskSignal ? [taskSignal] : [])]);
    signal.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          let lane: Awaited<ReturnType<HostedDependencies["resolve"]>>;
          try { lane = await deps.resolve(); }
          catch {
            signal.throwIfAborted();
            deps.assertActive();
            throw new HostedRunbookWaiting("Hosted routing unavailable; work retained");
          }
          signal.throwIfAborted();
          deps.assertActive();
          let claimed: boolean;
          try { claimed = await deps.claim(lane.model); }
          catch {
            signal.throwIfAborted();
            deps.assertActive();
            throw new HostedRunbookWaiting("Hosted admission unavailable; work retained");
          }
          if (!claimed) throw new HostedRunbookWaiting("Runbook hosted recovery blocked by autonomous budget; work retained");
          signal.throwIfAborted();
          deps.assertActive();
          const response = await lane.generate(messages, signal);
          signal.throwIfAborted();
          deps.assertActive();
          const choice = response.choices?.[0];
          const content = choice?.message?.content;
          if (typeof response.model !== "string" || !response.model ||
              response.choices?.length !== 1 || choice?.finish_reason !== "stop" ||
              choice.message.refusal || choice.message.tool_calls?.length || choice.message.function_call ||
              (response.usage?.completion_tokens !== undefined &&
                (!Number.isSafeInteger(response.usage.completion_tokens) ||
                 response.usage.completion_tokens < 0 || response.usage.completion_tokens > 2048)) ||
              typeof content !== "string" || !content.trim() || content.length > 12_000 ||
              /<\/?think>|<\|(?:tool|function)/i.test(content)) {
            throw Error("Hosted runbook response failed text checks");
          }
          return { model: response.model, content: content.trim() };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(Error("Hosted runbook recovery deadline exceeded"));
          }, 90_000);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };
}

const generate = createHostedRunbookGenerator({
  assertActive: () => {
    assertRunbookActive();
    if (!localHostedFallbackEnabled()) throw Error("Hosted runbook recovery disabled");
  },
  resolve: async () => {
    const { getClientForModel, getModelForTier } = await import("../providers");
    const { client, actualModelId } = await getClientForModel(getModelForTier("fast"), 1);
    return {
      model: actualModelId,
      generate: (messages, signal) => client.chat.completions.create({
        model: actualModelId, stream: false, max_tokens: 2048, temperature: 0,
        messages, response_format: { type: "json_object" },
      }, { signal, timeout: 90_000, maxRetries: 0 }),
    };
  },
  claim: async model => {
    const { claimAutonomousBudget } = await import("../agentic/autonomous-budget");
    const { estimateCostUsd } = await import("../agentic/cost-ledger");
    // Conservative input-token upper bound, not chars/4. Existing claims and
    // normal provider-ledger tracking remain authoritative for hosted costs.
    return (await claimAutonomousBudget({ tenantId: 1,
      estimatedUsd: Math.max(0.02, 2 * estimateCostUsd(model, 13_000, 2048)),
      label: "local-runbook:hosted-recovery",
    })).ok;
  },
});

export function generateHostedRunbook(messages: Messages, signal?: AbortSignal) {
  // Verify real context BEFORE establishing the explicit owner billing context.
  assertRunbookActive();
  return withTenantContext({ tenantId: 1, source: "background-job" }, () => generate(messages, signal));
}
