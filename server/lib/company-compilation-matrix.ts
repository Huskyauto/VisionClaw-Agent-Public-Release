import { correctionCheck, compilationReceiptDigest } from "./company-compilation-correction-policy";
/** Exact owner-requested topology; optional owner-approved one-shot corrections
 * retain original receipts and never create another jury or retry loop. */
export const COMPILATION_KINDS = ["readiness", "executive", "opportunities"] as const;
export const COMPILATION_AUTHORS = [
  { model: "gpt-5.4", lane: "openai-api" },
  { model: "google/gemini-4-argon", lane: "openrouter" },
  { model: "claude-opus-5-5", lane: "anthropic-api" },
] as const;
export const COMPILATION_SYNTHESIZER = { model: "claude-sonnet-5-5", lane: "anthropic-api" } as const;
export function compilationOutputTokens(op: { stage: string; lane: string }): number {
  // Provider output can include reasoning as well as the bounded report body.
  // Reserve this full allowance before dispatch; prose/narration caps stay fixed.
  return op.stage === "synthesis" ? 32_768 : 16_384;
}
export type CompilationOperation = { key: string; stage: "author" | "synthesis";
  kind: typeof COMPILATION_KINDS[number]; model: string; lane: typeof COMPILATION_AUTHORS[number]["lane"] };
export type CompilationCorrectionReceipt = {
  phase: "claimed" | "received" | "complete"; originalDigest: string; check: string; raw?: unknown; digestVersion?: 2;
  preflightRejected?: true;
};
export type TargetedCompilationRepairPort = {
  operation: string;
  request(operation: CompilationOperation, drafts: string[], original: unknown, check: string): Promise<unknown>;
};
export type CompilationMatrix = {
  version: 1; subject: string; phase: "authors" | "synthesis" | "complete" | "blocked";
  /** Bound at creation; absent on retained packages so their request identities stay stable. */
  readingStyle?: "concise-bullets-v1";
  slots: Record<string, { phase: "claimed" | "received" | "complete"; raw?: unknown; text?: string; outputContract?: 2;
    preflightRejected?: true;
    correction?: CompilationCorrectionReceipt; targetedRepair?: CompilationCorrectionReceipt;
    reconciledUnspentClaim?: CompilationCorrectionReceipt;
    reconciledUnspentTargetedRepair?: CompilationCorrectionReceipt }>;
  replacements?: Record<string, { raw: unknown; digest: string; snapshot: string; approvedAt: string }>;
};
/** Created ONLY before entering the durable reservation boundary. A reservation
 * failure is ambiguous and MUST NOT be wrapped in this error. */
export class CompilationPreflightRejection extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Compilation preflight rejected", { cause });
    this.name = "CompilationPreflightRejection";
  }
}
export function compilationOperations(): CompilationOperation[] {
  return [
    ...COMPILATION_KINDS.flatMap(kind => COMPILATION_AUTHORS.map(s => ({
      key: `author:${kind}:${s.model}`, stage: "author" as const, kind, ...s,
    }))),
    ...COMPILATION_KINDS.map(kind => ({
      key: `synthesis:${kind}:${COMPILATION_SYNTHESIZER.model}`, stage: "synthesis" as const,
      kind, ...COMPILATION_SYNTHESIZER,
    })),
  ];
}
export function newCompilationMatrix(subject: string): CompilationMatrix {
  if (!subject) throw new Error("Compilation subject required");
  return { version: 1, subject, phase: "authors", slots: {}, readingStyle: "concise-bullets-v1" };
}
export async function advanceCompilationMatrix(state: CompilationMatrix, ports: {
  checkpoint(state: CompilationMatrix): Promise<void>;
  request(operation: CompilationOperation, drafts: string[]): Promise<unknown>;
  accept(operation: CompilationOperation, raw: unknown): string;
  correct?(operation: CompilationOperation, drafts: string[], original: unknown, check: string): Promise<unknown>;
  targetedRepair?: TargetedCompilationRepairPort;
  outputContract?: 2;
}, selectedOperation?: CompilationOperation, deferPhase = false) {
  if (state.phase === "blocked") throw new Error("Compilation is stopped; no automatic retry");
  if (state.phase === "complete") return;
  const operations = compilationOperations();
  if (Object.keys(state.slots).some(key => !operations.some(op => op.key === key)))
    throw new Error("Unknown compilation operation");
  const op = selectedOperation ?? operations.find(op => state.slots[op.key]?.phase !== "complete");
  if (!op) { state.phase = "complete"; await ports.checkpoint(state); return; }
  const drafts = op.stage === "author" ? [] : COMPILATION_AUTHORS.map(a => {
    const slot = state.slots[`author:${op.kind}:${a.model}`];
    if (slot?.phase !== "complete" || !slot.text) throw new Error("Three complete author compilations required");
    return slot.text;
  });
  try {
    let slot = state.slots[op.key];
    if (slot?.phase === "claimed" && !slot.preflightRejected)
      throw new Error("Compilation completion uncertain; reconcile retained claim");
    if (!slot || slot.preflightRejected) {
      const outputContract = slot?.outputContract ?? ports.outputContract;
      state.slots[op.key] = slot = { phase: "claimed",
        ...(outputContract === 2 ? { outputContract: 2 as const } : {}) };
      await ports.checkpoint(state); // Atomic host claim MUST commit before request.
      try { slot.raw = await ports.request(op, drafts); }
      catch (error) {
        if (error instanceof CompilationPreflightRejection) slot.preflightRejected = true;
        throw error;
      }
      slot.phase = "received";
      await ports.checkpoint(state); // Retain before any parsing/content rejection.
    }
    let text: string;
    if (slot.targetedRepair?.preflightRejected) {
      slot.reconciledUnspentTargetedRepair = slot.targetedRepair;
      delete slot.targetedRepair;
      await ports.checkpoint(state);
    }
    if (slot.correction?.preflightRejected) {
      slot.reconciledUnspentClaim = slot.correction;
      delete slot.correction;
      await ports.checkpoint(state);
    }
    if (slot.correction) {
      if (slot.correction.originalDigest !== compilationReceiptDigest(slot.raw, slot.correction.digestVersion) ||
          slot.correction.phase === "claimed")
        throw new Error("Compilation correction completion uncertain; reconcile retained claim");
      if (slot.targetedRepair) {
        if (slot.targetedRepair.originalDigest !== compilationReceiptDigest(slot.correction.raw) ||
            slot.targetedRepair.phase === "claimed")
          throw new Error("Targeted compilation repair completion uncertain; reconcile retained claim");
        text = ports.accept(op, slot.targetedRepair.raw);
      } else {
        try { text = ports.accept(op, slot.correction.raw); } catch (error) {
          const check = correctionCheck(op, slot.correction.raw, error);
          if (ports.targetedRepair?.operation !== op.key || check !== "AUTHOR_SIZE_LIMIT" ||
              slot.correction.phase !== "received" || state.replacements?.[op.key]) throw error;
          const repair: CompilationCorrectionReceipt = slot.targetedRepair = {
            phase: "claimed", originalDigest: compilationReceiptDigest(slot.correction.raw), check,
          };
          await ports.checkpoint(state);
           try { repair.raw = await ports.targetedRepair.request(op, drafts, slot.correction.raw, check); }
           catch (error) {
             if (error instanceof CompilationPreflightRejection) repair.preflightRejected = true;
             throw error;
           }
          repair.phase = "received";
          await ports.checkpoint(state);
          text = ports.accept(op, repair.raw);
        }
      }
    } else {
      try { text = ports.accept(op, slot.raw); } catch (error) {
        const check = correctionCheck(op, slot.raw, error);
        if (!ports.correct || !check || state.replacements?.[op.key]) throw error;
         const correction: CompilationCorrectionReceipt = slot.correction = { phase: "claimed" as "claimed" | "received" | "complete",
          originalDigest: compilationReceiptDigest(slot.raw, 2), digestVersion: 2 as const, check, raw: undefined as unknown };
        await ports.checkpoint(state);
         try { correction.raw = await ports.correct(op, drafts, slot.raw, check); }
         catch (error) {
           if (error instanceof CompilationPreflightRejection) correction.preflightRejected = true;
           throw error;
         }
        correction.phase = "received";
        await ports.checkpoint(state);
        text = ports.accept(op, correction.raw);
      }
    }
    if (!text?.trim()) throw new Error("Compilation has no accepted full text");
    if (slot.targetedRepair) slot.targetedRepair.phase = "complete";
    else if (slot.correction) slot.correction.phase = "complete";
    slot.text = text; slot.phase = "complete";
    if (!deferPhase) state.phase = operations.every(o => state.slots[o.key]?.phase === "complete") ? "complete" :
      operations.filter(o => o.stage === "author").every(o => state.slots[o.key]?.phase === "complete") ? "synthesis" : "authors";
    await ports.checkpoint(state);
  } catch (error) {
    if (!deferPhase) state.phase = "blocked";
    await ports.checkpoint(state); throw error;
  }
}
