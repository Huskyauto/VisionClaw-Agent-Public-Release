import { semanticRank } from "../tool-curator";

const ENV_DISABLE = process.env.TOOL_PICK_VALIDATOR_DISABLE === "1";
const VALIDATOR_TOPK = 8;
const VALIDATOR_MIN_GAP = 0.08;
const VALIDATOR_MIN_SCORE = 0.30;

const _fired = new Map<string, number>();
const FIRED_TTL_MS = 60 * 60 * 1000;
const FIRED_MAX_ENTRIES = 1000;

let _hits = 0;
let _suggested = 0;
let _silent = 0;
let _errs = 0;

export interface ValidatorVerdict {
  shouldHint: boolean;
  betterTool?: string;
  betterToolScore?: number;
  pickedScore?: number;
  reasoning?: string;
}

interface ToolDefinition {
  type: "function";
  function: { name: string; description?: string; parameters?: any };
}

export function hasFiredThisSession(sessionKey: string): boolean {
  const ts = _fired.get(sessionKey);
  if (!ts) return false;
  if (Date.now() - ts > FIRED_TTL_MS) {
    _fired.delete(sessionKey);
    return false;
  }
  return true;
}

export function markFired(sessionKey: string): void {
  _fired.set(sessionKey, Date.now());
  if (_fired.size > FIRED_MAX_ENTRIES) {
    // R113 hardening (architect MEDIUM): pruning expired entries is not enough —
    // under high concurrency, 1000+ live sessions can fire within the 60-min TTL
    // and exceed the soft cap without bound. Strict LRU: drop oldest first,
    // ignoring TTL, until we are back under the cap.
    const cutoff = Date.now() - FIRED_TTL_MS;
    for (const [k, v] of _fired.entries()) {
      if (v < cutoff) _fired.delete(k);
    }
    if (_fired.size > FIRED_MAX_ENTRIES) {
      const overflow = _fired.size - FIRED_MAX_ENTRIES;
      const sorted = Array.from(_fired.entries()).sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < overflow; i++) _fired.delete(sorted[i][0]);
    }
  }
}

export async function validateToolPick(args: {
  userMessage: string;
  pickedTool: string;
  availableTools: ToolDefinition[];
}): Promise<ValidatorVerdict> {
  if (ENV_DISABLE) return { shouldHint: false };
  if (!args.userMessage || args.userMessage.length < 8) return { shouldHint: false };
  if (!args.pickedTool) return { shouldHint: false };

  try {
    _hits++;
    const candidateSet = new Set(args.availableTools.map(t => t.function.name));
    if (!candidateSet.has(args.pickedTool)) return { shouldHint: false };

    const ranked = await semanticRank(args.userMessage, {
      topK: VALIDATOR_TOPK,
      candidatePool: candidateSet,
      minScore: VALIDATOR_MIN_SCORE,
    });

    if (ranked.length < 2) {
      _silent++;
      return { shouldHint: false };
    }

    const pickedEntry = ranked.find(r => r.name === args.pickedTool);
    const top = ranked[0];

    if (top.name === args.pickedTool) {
      _silent++;
      return { shouldHint: false };
    }

    const pickedScore = pickedEntry?.score ?? 0;
    const gap = top.score - pickedScore;

    if (gap < VALIDATOR_MIN_GAP) {
      _silent++;
      return { shouldHint: false };
    }

    const topDesc = args.availableTools.find(t => t.function.name === top.name)?.function.description?.slice(0, 200) || "";

    _suggested++;
    return {
      shouldHint: true,
      betterTool: top.name,
      betterToolScore: top.score,
      pickedScore,
      reasoning: `${top.name} scored ${top.score.toFixed(2)} vs ${args.pickedTool} at ${pickedScore.toFixed(2)} (Δ ${gap.toFixed(2)}). ${topDesc}`,
    };
  } catch (err) {
    _errs++;
    console.warn("[tool-pick-validator] failed:", (err as Error).message);
    return { shouldHint: false };
  }
}

export function formatValidatorHint(verdict: ValidatorVerdict): string {
  if (!verdict.shouldHint || !verdict.betterTool) return "";
  return `\n\n═══ ★ TOOL SELECTION HINT (R112.18 Layer 3) ★ ═══\nYour first tool pick this session may not be the sharpest fit. Embedding match suggests \`${verdict.betterTool}\` is a stronger match for the user's actual intent: ${verdict.reasoning}\nIf the user asks for the same kind of thing again this turn, prefer \`${verdict.betterTool}\`. This hint fires ONCE per session — read it carefully.\n═════════════════════════════════════════════════\n`;
}

export function getValidatorStats() {
  return { evaluated: _hits, suggested: _suggested, silent: _silent, errors: _errs, sessionsTracked: _fired.size };
}
