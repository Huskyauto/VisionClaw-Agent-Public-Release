import type { ProposerCallSpec, ProposerResult } from "../moa";

export type ReportAttemptEvent = {
  index: number; spec: ProposerCallSpec; stage: "started" | "settled" | "late";
  at: string; result?: ProposerResult;
};

/** A report-only collector. Transport success is NOT ballot success.
 * Candidates are claimed synchronously, and settlement is durable before count.
 * A hung collaborator cannot hold the caller past the common cutoff.
 */
export async function collectReportBallots(args: {
  candidates: readonly ProposerCallSpec[];
  attempt(spec: ProposerCallSpec, signal: AbortSignal): Promise<ProposerResult>;
  valid(result: ProposerResult): boolean;
  record(event: ReportAttemptEvent): Promise<void>;
  eligible?(spec: ProposerCallSpec): boolean;
  signal?: AbortSignal;
  budgetMs?: number; reserveMs?: number; minimumAttemptMs?: number;
  now?: () => number;
}) {
  const now = args.now ?? (() => performance.now());
  const started = now(), cutoff = started + (args.budgetMs ?? 180_000) - (args.reserveMs ?? 10_000);
  const controller = new AbortController(), results: ProposerResult[] = [];
  const identities = new Set<string>(), runs = new Set<string>(), claimed = new Set<string>();
  const activeLanes = new Set<string>();
  const completedLanes = new Set<string>();
  let attempts = 0, counted = 0, reason = "no_candidates";
  let wake!: () => void;
  const closed = new Promise<void>(resolve => { wake = resolve; });
  const close = (why: string) => {
    if (controller.signal.aborted) return;
    reason = why;
    controller.abort();
    wake();
  };
  const parentAbort = () => close("aborted");
  args.signal?.addEventListener("abort", parentAbort, { once: true });
  if (args.signal?.aborted) close("aborted");
  const timer = setTimeout(() => close("deadline"), Math.max(0, cutoff - now()));
  const open = () => !controller.signal.aborted && now() < cutoff;
  const record = async (event: ReportAttemptEvent) => {
    try { await args.record(event); }
    catch { close("audit_persistence_failed"); throw new Error("Report attempt audit unavailable"); }
  };
  const worker = async () => {
    while (open() && counted < 3 && attempts < 9) {
      if (cutoff - now() < (args.minimumAttemptMs ?? 15_000)) break;
      const spec = args.candidates.find(candidate => {
        const lane = candidate.providerLane ?? candidate.modelId;
        return !claimed.has(`${lane}:${candidate.modelId}`) && !activeLanes.has(lane) && !completedLanes.has(lane) &&
          (args.eligible?.(candidate) ?? true);
      });
      if (!spec) return;
      const lane = spec.providerLane ?? spec.modelId;
      claimed.add(`${lane}:${spec.modelId}`);
      activeLanes.add(lane);
      const index = attempts++, attemptStart = now();
      const bounded = { ...spec, maxTokens: 8192, noRetry: true,
        clientTimeoutMs: Math.max(1, cutoff - now()),
        timeoutMs: Math.min(spec.timeoutMs ?? 90_000, cutoff - now()) };
      try {
        await record({ index, spec: bounded, stage: "started", at: new Date().toISOString() });
        if (!open()) return;
        let result: ProposerResult;
        try { result = await args.attempt(bounded, controller.signal); }
        catch { result = { modelId: spec.modelId, provider: lane, providerLane: spec.providerLane,
          ok: false, error: "Report transport failed", latencyMs: now() - attemptStart }; }
        if (!open()) {
          await record({ index, spec: bounded, stage: "late", at: new Date().toISOString(), result });
          return;
        }
        const identity = result.reportedModel?.trim().toLowerCase();
        const run = result.evidence?.runId;
        const valid = result.ok && args.valid(result) && !!identity && !identities.has(identity) &&
          (!run || !runs.has(run));
        if (valid) { identities.add(identity!); if (run) runs.add(run); }
        const settled = valid ? result : { ...result, ok: false,
          error: result.error || "Report ballot invalid, incomplete, or duplicate" };
        await record({ index, spec: bounded, stage: "settled", at: new Date().toISOString(), result: settled });
        if (!open()) return;
        results.push(settled);
        if (valid) {
          completedLanes.add(lane);
          counted++;
          if (counted === 3) close("ballot_complete");
          return; // This seat is complete; never hedge another seat's work.
        }
      } finally {
        activeLanes.delete(lane);
      }
    }
  };
  const work = Promise.all([worker(), worker(), worker()])
    .catch(() => { close("audit_or_validation_failed"); })
    .then(() => { if (!controller.signal.aborted) close(attempts >= 9 ? "attempt_cap" : "no_candidates"); });
  try {
    await Promise.race([work, closed]);
    return { results, complete: counted === 3 && reason === "ballot_complete", reason,
      elapsedMs: now() - started };
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", parentAbort);
    if (!controller.signal.aborted) close("closed");
  }
}
