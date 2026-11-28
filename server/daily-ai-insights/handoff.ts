import { VERSION } from "./core";
import { createStore, assertOwner } from "./store";

/** This is an explicit owner action, never a daily intake/model callback. */
export async function promoteCandidate(tenant: number, reviewId: number, identity: string, evidenceHash: string, deps: {
  store?: Pick<ReturnType<typeof createStore>, "reserveHandoff" | "read" | "recordHandoff" | "effect">;
  dispatch?: (payload: import("../source-repair-handoff").RepairHandoffPayload) => Promise<{ accepted: boolean; handoffId?: number; blocker?: string }>;
} = {}) {
  assertOwner(tenant);
  const store = deps.store ?? createStore(tenant);
  const { candidate, review, prior } = await store.reserveHandoff(reviewId, identity, evidenceHash);
  if (prior) {
    // A timeout may already have been accepted by the signed inbox. Reuse the
    // same exact subject on explicit owner retry; never mint a fresh build key.
    if (prior.accepted || prior.evidenceHash !== evidenceHash) return { ...prior, reused: true };
  }
  if ((await store.read()).paused) throw new Error("Daily insights is paused");
  const evidence = JSON.stringify({
    reviewer: VERSION, reviewId, outputId: review.outputId, outputDigest: review.digest,
    inputs: review.inputs.map(r => ({ id: r.id, digest: r.digest, protocol: r.protocol, revision: r.revision })),
    source: { url: candidate.sourceUrl, quote: candidate.quote },
    existingCode: { path: candidate.capabilityPath, quote: candidate.capabilityQuote },
    test: candidate.test, cost: candidate.cost, risk: candidate.risk,
  });
  if (evidence.length > 8000) throw new Error("Candidate provenance exceeds handoff bounds; no evidence was truncated");
  const dispatch = deps.dispatch ?? (await import("../source-repair-handoff")).dispatchRepairHandoff;
  const result = await store.effect(null, () => dispatch({
    tenantId: tenant, sourceFindingId: `daily-insights:${identity}`,
    sourceEvidenceVersion: VERSION, sourceEvidenceHash: evidenceHash,
    findingIntent: `Owner requests independent workspace assessment of this research candidate, not approval to apply it: ${candidate.title}. ${candidate.reason}
Do not change intake/evaluators/policies/safety/limits/approvals. Independently inspect source and validate evidence.
Retain or reject if not justified; existing verifier, independent approval and apply controls remain required.`,
    evidence,
  }));
  await store.recordHandoff(reviewId, identity, { ...result, evidenceHash, at: new Date().toISOString() });
  return result;
}
