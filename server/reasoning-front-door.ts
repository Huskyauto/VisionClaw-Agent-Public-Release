/**
 * Reasoning Front Door — "judgment above the rails"
 *
 * Today an incoming chat turn is routed by a category CLASSIFIER (auto-router)
 * before the agent ever forms an opinion about what is actually being asked.
 * That pre-empts judgment: the classifier decides, the agent executes.
 *
 * This module inverts that. Before routing, the agent forms an EXPLICIT plan —
 * intent, confidence, the route it believes is right, whether the request needs
 * deliberation, which peer personas to pull in, and the output shape — plus a
 * short reasoning trace. The category classifier is demoted from DECIDER to
 * HINT: when the front door is confident, ITS chosen category drives model
 * selection; otherwise the classifier runs exactly as before.
 *
 * Design invariants (mirror orchestration-efficiency.ts):
 *  - ENV-GATED + default OFF. With REASONING_FRONT_DOOR unset, this code path is
 *    never entered and the live request loop is byte-identical to today.
 *  - FAIL-OPEN. Any error, timeout, disabled flag, or unparseable model output
 *    returns null → the caller falls back to the existing router. The front door
 *    can never block, slow past its bound, or throw into the hot path.
 *  - BOUNDED. The LLM call is wrapped in a hard timeout (AbortController +
 *    Promise.race); a slow provider degrades to null, never a hung turn.
 *  - $0-COST FIRST. Uses the free modelfarm classifier lane (gemini-2.5-flash)
 *    with the same actualModelId discipline as auto-router's llmClassify.
 *  - OBSERVABLE. Every plan is logged and recorded to orchestration_efficiency
 *    so the agent's self-routing judgment is auditable, not a black box.
 */

import {
  getClientForModel,
  getAvailableModels,
  getUnhealthyProviders,
  MODEL_REGISTRY,
} from "./providers";
import { listRouteCategories } from "./auto-router";
import { recordOrchestrationEfficiency } from "./orchestration-efficiency";
import { logSilentCatch } from "./lib/silent-catch";
import {
  type FrontDoorPlan,
  isFrontDoorEnabled,
  parseFrontDoorPlan,
  withDeadline,
} from "./reasoning-front-door-core";

export {
  type FrontDoorPlan,
  CONFIDENCE_THRESHOLD,
  isFrontDoorEnabled,
  shouldTrustPlan,
  parseFrontDoorPlan,
} from "./reasoning-front-door-core";

export interface FrontDoorInput {
  userMessage: string;
  tenantId?: number;
  personaName?: string;
  knownPersonas?: string[];
  routerHint?: { category?: string; confidence?: number; reason?: string };
}

const TIMEOUT_MS = 6000;

const CLASSIFIER_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gpt-5-mini",
  "deepseek/deepseek-v3.2",
  "gemini-3.5-flash",
];

function buildPrompt(input: FrontDoorInput, categories: string[]): string {
  const personas = (input.knownPersonas && input.knownPersonas.length)
    ? input.knownPersonas.join(", ")
    : "none provided";
  const hint = input.routerHint?.category
    ? `A cheap classifier's prior guess is category="${input.routerHint.category}" (confidence ${input.routerHint.confidence ?? "?"}). Treat this as a HINT only — overrule it if your own reading of the request disagrees.`
    : "No classifier hint available.";
  return [
    `You are the reasoning front door for an AI persona${input.personaName ? ` named "${input.personaName}"` : ""}.`,
    `Before any work happens, read the user's request and form an explicit plan.`,
    ``,
    `Routable categories (pick the ONE that best fits): ${categories.join(", ")}.`,
    `Known peer personas you may recommend consulting: ${personas}.`,
    hint,
    ``,
    `Respond with STRICT JSON only, no prose, with exactly these fields:`,
    `{`,
    `  "intent": "<one sentence: what the user actually wants>",`,
    `  "category": "<one of the routable categories>",`,
    `  "confidence": <0.0-1.0 how sure you are about intent+category>,`,
    `  "needsDeliberation": <true if this is ambiguous/complex/high-stakes enough to warrant multi-model deliberation, else false>,`,
    `  "peersToConsult": [<zero or more peer persona names that would improve the outcome>],`,
    `  "outputShape": "<short description of the ideal output form>",`,
    `  "reasoning": "<1-3 sentences explaining your routing judgment>"`,
    `}`,
  ].join("\n");
}

async function pickClassifierClient(): Promise<{ client: any; modelId: string } | null> {
  try {
    const available = await getAvailableModels();
    const availableIds = new Set(available.map(m => m.id));
    const unhealthy = getUnhealthyProviders();
    for (const cm of CLASSIFIER_MODELS) {
      if (!availableIds.has(cm)) continue;
      const prov = MODEL_REGISTRY.find(m => m.id === cm)?.provider;
      if (prov && unhealthy.has(prov)) continue;
      try {
        const r = await getClientForModel(cm);
        return { client: r.client, modelId: r.actualModelId };
      } catch (_e) { logSilentCatch("server/reasoning-front-door.ts", _e); }
    }
    const r = await getClientForModel("gemini-2.5-flash");
    return { client: r.client, modelId: r.actualModelId };
  } catch (_e) {
    logSilentCatch("server/reasoning-front-door.ts", _e);
    return null;
  }
}

/**
 * Run the reasoning front door. Returns a structured plan, or null (fail-open).
 * Never throws. Never blocks past TIMEOUT_MS — the ENTIRE flow (client discovery
 * + completion call + parse) is bounded by a single hard deadline via
 * `withDeadline`, and on expiry an AbortController cancels the in-flight HTTP call.
 */
export async function runReasoningFrontDoor(input: FrontDoorInput): Promise<FrontDoorPlan | null> {
  if (!isFrontDoorEnabled()) return null;
  const message = (input.userMessage || "").trim();
  if (!message) return null;

  const categories = listRouteCategories();
  const truncated = message.length > 1200 ? message.slice(0, 1200) + "..." : message;

  const controller = new AbortController();

  // The whole pipeline — including client discovery, which itself awaits — runs
  // inside `work` so the deadline bounds EVERYTHING, not just the network call.
  const work = (async (): Promise<FrontDoorPlan | null> => {
    const picked = await pickClassifierClient();
    if (!picked) return null;

    const resp: any = await picked.client.chat.completions.create(
      {
        model: picked.modelId,
        messages: [
          { role: "system", content: buildPrompt(input, categories) },
          { role: "user", content: truncated },
        ],
        max_completion_tokens: 600,
      },
      { signal: controller.signal },
    );

    const text = resp?.choices?.[0]?.message?.content?.trim() || "";
    return parseFrontDoorPlan(text, {
      modelUsed: picked.modelId,
      routableCategories: categories,
      fallbackCategory: input.routerHint?.category,
    });
  })();

  try {
    // On timeout, abort the in-flight call; withDeadline clears the timer and
    // swallows the loser's late settlement so it can never leak as an unhandled rejection.
    const plan = await withDeadline(work, TIMEOUT_MS, () => controller.abort());
    if (!plan) return null;

    console.log(
      `[front-door] intent="${plan.intent.slice(0, 80)}" → ${plan.category} ` +
      `(conf ${plan.confidence}, deliberate=${plan.needsDeliberation}` +
      `${plan.peersToConsult.length ? `, peers=${plan.peersToConsult.join("/")}` : ""})`,
    );

    if (input.tenantId && Number.isInteger(input.tenantId) && input.tenantId > 0) {
      void recordOrchestrationEfficiency({
        tenantId: input.tenantId,
        requestClass: plan.category,
        label: "reasoning-front-door",
        guardVerdict: plan.needsDeliberation ? "worth" : "neutral",
        triviality: Math.round((1 - plan.confidence) * 100) / 100,
      });
    }

    return plan;
  } catch (_e) {
    logSilentCatch("server/reasoning-front-door.ts", _e);
    return null;
  }
}
