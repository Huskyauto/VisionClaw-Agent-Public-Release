/**
 * Reasoning Front Door — PURE core (no DB, no providers, no LLM imports).
 *
 * Kept dependency-free so its logic is unit-testable in isolation without
 * dragging in the providers/db module graph (which keeps the pg pool / event
 * loop alive and hangs node:test). The runtime orchestration lives in
 * ./reasoning-front-door.ts, which re-exports everything here.
 *
 * NOTE: ./lib/silent-catch is itself dependency-free (process.env + Map +
 * console.warn only), so importing it keeps the node:test-safe property.
 */
import { logSilentCatch } from "./lib/silent-catch";

export interface FrontDoorPlan {
  intent: string;
  category: string;
  confidence: number;
  needsDeliberation: boolean;
  peersToConsult: string[];
  outputShape: string;
  reasoning: string;
  modelUsed: string;
  source: "reasoning-front-door";
}

export const CONFIDENCE_THRESHOLD = 0.6;

export function isFrontDoorEnabled(): boolean {
  return process.env.REASONING_FRONT_DOOR === "1";
}

/**
 * Bound a promise with a hard deadline. Resolves to the work's value if it wins,
 * or null if the deadline expires first. On expiry it fires `onExpire` (used to
 * AbortController.abort() the in-flight call) and swallows the loser's late
 * settlement so it can never surface as an unhandled rejection. The timer is
 * always cleared. Pure (no heavy imports) so the timeout invariant is unit-testable.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onExpire?: () => void,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      try { onExpire?.(); } catch (_silentErr) { logSilentCatch("server/reasoning-front-door-core.ts", _silentErr); }
      resolve(null);
    }, ms);
  });
  try {
    return (await Promise.race([work, timeout])) as T | null;
  } finally {
    if (timer) clearTimeout(timer);
    void Promise.resolve(work).catch(() => { /* swallow late rejection */ });
  }
}

/**
 * Whether the wiring layer should let this plan OVERRIDE the category classifier.
 * Conservative: only a confident plan whose category the router actually knows.
 */
export function shouldTrustPlan(plan: FrontDoorPlan | null, routableCategories: string[]): boolean {
  if (!plan) return false;
  if (plan.confidence < CONFIDENCE_THRESHOLD) return false;
  return routableCategories.includes(plan.category);
}

/**
 * Pure parser — no LLM, no DB. Returns null on any shape it cannot trust
 * (fail-open contract).
 */
export function parseFrontDoorPlan(
  rawText: string,
  ctx: { modelUsed: string; routableCategories: string[]; fallbackCategory?: string },
): FrontDoorPlan | null {
  if (!rawText || typeof rawText !== "string") return null;
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const intent = typeof parsed.intent === "string" ? parsed.intent.trim() : "";
  if (!intent) return null;

  let category = typeof parsed.category === "string" ? parsed.category.trim() : "";
  if (!ctx.routableCategories.includes(category)) {
    category = ctx.fallbackCategory && ctx.routableCategories.includes(ctx.fallbackCategory)
      ? ctx.fallbackCategory
      : (ctx.routableCategories[0] || "general");
  }

  let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  const needsDeliberation = parsed.needsDeliberation === true;

  const peersToConsult = Array.isArray(parsed.peersToConsult)
    ? parsed.peersToConsult.filter((p: any) => typeof p === "string" && p.trim()).map((p: string) => p.trim()).slice(0, 5)
    : [];

  const outputShape = typeof parsed.outputShape === "string" ? parsed.outputShape.trim().slice(0, 280) : "";
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim().slice(0, 600) : "";

  return {
    intent: intent.slice(0, 400),
    category,
    confidence,
    needsDeliberation,
    peersToConsult,
    outputShape,
    reasoning,
    modelUsed: ctx.modelUsed,
    source: "reasoning-front-door",
  };
}
